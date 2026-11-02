import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  appSecrets,
  appTemplatedSecrets,
  bucketSyncKeys,
  pushSecret,
  pushStore,
  secretKeys,
  secretRef,
} from "./secrets.ts";

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const hasHelm = (() => {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("pushStore", () => {
  test("writes into one namespace, as the service account that may", () => {
    assert.deepEqual(pushStore("app"), {
      apiVersion: "external-secrets.io/v1",
      kind: "SecretStore",
      metadata: { name: "app", namespace: "external-secrets-operator" },
      spec: {
        provider: {
          kubernetes: {
            auth: { serviceAccount: { name: "secrets-pusher" } },
            remoteNamespace: "app",
            server: {
              caProvider: {
                key: "ca.crt",
                name: "kube-root-ca.crt",
                type: "ConfigMap",
              },
            },
          },
        },
      },
    });
  });
});

describe("pushSecret", () => {
  test("builds a Secret from templates, and pushes each of its keys", () => {
    const secret = pushSecret({
      namespace: "app",
      name: "credentials",
      templates: { A: "{{ a }}", B: "{{ b }}" },
    });
    assert.equal(secret.kind, "PushSecret");
    assert.deepEqual(secret.metadata, {
      name: "app-credentials",
      namespace: "external-secrets-operator",
    });
    assert.deepEqual(secret.spec.selector, { secret: { name: "apps" } });
    assert.deepEqual(secret.spec.secretStoreRefs, [
      { kind: "SecretStore", name: "app" },
    ]);
    assert.deepEqual(secret.spec.template, {
      engineVersion: "v2",
      data: { A: "{{ a }}", B: "{{ b }}" },
    });
    assert.deepEqual(secret.spec.data, [
      {
        match: {
          remoteRef: { property: "A", remoteKey: "credentials" },
          secretKey: "A",
        },
      },
      {
        match: {
          remoteRef: { property: "B", remoteKey: "credentials" },
          secretKey: "B",
        },
      },
    ]);
  });

  test("replaces what is there, and removes what it pushed when it goes", () => {
    const { spec } = pushSecret({
      namespace: "app",
      name: "credentials",
      templates: { A: "a" },
    });
    assert.equal(spec.updatePolicy, "Replace");
    assert.equal(spec.deletionPolicy, "Delete");
  });

  test("is named for the Secret, so that an app can push several", () => {
    const names = ["one", "two"].map(
      (name) =>
        pushSecret({ namespace: "app", name, templates: { A: "a" } }).metadata
          .name,
    );
    assert.deepEqual(names, ["app-one", "app-two"]);
  });

  test("a Secret with no keys is an error", () => {
    assert.throws(
      () =>
        pushSecret({ namespace: "app", name: "credentials", templates: {} }),
      /the Secret credentials in app has no keys/,
    );
  });

  test("names that would escape a template or an object name are refused", () => {
    for (const bad of ['a" }}', "a b", "", "../x"]) {
      assert.throws(() => secretRef(bad, "app"), /not a plain name/);
      assert.throws(() => secretRef("key", bad), /not a plain name/);
      assert.throws(
        () =>
          pushSecret({
            namespace: "app",
            name: "credentials",
            templates: { [bad]: "x" },
          }),
        /not a plain name/,
      );
      assert.throws(
        () =>
          pushSecret({ namespace: "app", name: bad, templates: { A: "a" } }),
        /not a plain name/,
      );
    }
  });
});

describe("appSecrets", () => {
  test("copies keys of the app's own section into a Secret of the name it is given", () => {
    const [secret, ...rest] = appSecrets("web", "credentials", [
      "token",
      "other-key",
    ]);
    assert.equal(rest.length, 0);
    assert.equal(secret.metadata.name, "web-credentials");
    assert.deepEqual(secret.spec.template.data, {
      token: secretRef("token", "web"),
      "other-key": secretRef("other-key", "web"),
    });
  });

  test("can read another app's section, into a Secret of another name and namespace", () => {
    const [secret] = appSecrets("llama-cpp", "bucket-sync-x", bucketSyncKeys, {
      from: "bucket-sync",
      namespace: "elsewhere",
    });
    assert.equal(secret.metadata.name, "elsewhere-bucket-sync-x");
    assert.deepEqual(secret.spec.secretStoreRefs, [
      { kind: "SecretStore", name: "elsewhere" },
    ]);
    assert.equal(
      secret.spec.template.data["encryption-key"],
      secretRef("encryption-key", "bucket-sync"),
    );
  });
});

describe("appTemplatedSecrets", () => {
  test("builds the Secret's keys from the templates it is given", () => {
    const [secret] = appTemplatedSecrets("mail", "relay", {
      PASSWORD: `smtp:${secretRef("smtp", "mail")}`,
    });
    assert.equal(secret.metadata.name, "mail-relay");
    assert.equal(
      secret.spec.template.data.PASSWORD,
      `smtp:${secretRef("smtp", "mail")}`,
    );
    assert.deepEqual(
      secret.spec.data.map((d: any) => d.match.secretKey),
      ["PASSWORD"],
    );
  });
});

describe("secretKeys", () => {
  const secret = secretKeys("credentials", ["token", "other"]);

  test("reads a key through the Secret's name", () => {
    assert.equal(secret.name, "credentials");
    assert.deepEqual(secret.key("token"), {
      secretKeyRef: { name: "credentials", key: "token" },
    });
  });

  test("a key the Secret wasn't given is an error", () => {
    assert.throws(
      // @ts-expect-error: the key is checked when the code is typed, too
      () => secret.key("typo"),
      /the Secret credentials has no key 'typo'/,
    );
  });
});

// the template is the one thing that can't be checked by looking at it, so it is run with helm's
// template engine, which has the functions external secrets' does
describe(
  "secretRef, run as a template",
  { skip: !hasHelm && "helm is not installed" },
  () => {
    const chart = mkdtempSync(join(tmpdir(), "eso-template-"));
    dirs.push(chart);
    mkdirSync(join(chart, "templates"));
    writeFileSync(
      join(chart, "Chart.yaml"),
      "apiVersion: v2\nname: t\nversion: 0.0.1\n",
    );
    writeFileSync(
      join(chart, "values.yaml"),
      [
        "apps: |",
        "  secrets:",
        "    web:",
        '      api-token: "tok:with/odd chars"',
        '      empty: ""',
        "    other:",
        "      api-token: other-token",
        "",
      ].join("\n"),
    );

    const render = (template: string) => {
      writeFileSync(
        join(chart, "templates", "t.yaml"),
        `value: |-\n  ${template.replaceAll(".apps", ".Values.apps")}\n`,
      );
      return execFileSync("helm", ["template", "t", chart], {
        encoding: "utf-8",
        stdio: "pipe",
      })
        .split("\n")
        .slice(2)
        .join("\n")
        .trim();
    };

    test("reads a key of the app's section, whatever is in it", () => {
      assert.match(
        render(secretRef("api-token", "web")),
        /^value: \|-\n\s+tok:with\/odd chars$/,
      );
    });

    test("reads the section it is told to", () => {
      assert.match(render(secretRef("api-token", "other")), /other-token$/);
    });

    test("a key can be empty", () => {
      assert.match(render(secretRef("empty", "web")), /^value: \|-$/m);
    });

    test("several keys can be in one template", () => {
      const text = `a=${secretRef("api-token", "web")},b=${secretRef("api-token", "other")}`;
      assert.match(render(text), /a=tok:with\/odd chars,b=other-token$/);
    });

    test("a key that isn't there fails, and says which, rather than being empty", () => {
      assert.throws(
        () => render(secretRef("typo", "web")),
        /missing key web\.typo/,
      );
    });

    test("a section that isn't there fails too", () => {
      assert.throws(
        () => render(secretRef("api-token", "nope")),
        /missing key nope\.api-token|nil/,
      );
    });
  },
);
