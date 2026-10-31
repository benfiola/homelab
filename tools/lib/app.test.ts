import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { App } from "./app.ts";

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const kinds = async (h: App) =>
  (await h.objects()).map((o) => `${o.kind}/${o.metadata.name}`);

describe("App", () => {
  test("collects everything created through it, in creation order", async () => {
    const h = new App("web", "/apps/web");
    h.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "one" } });
    const workload = h
      .deployment("web")
      .addContainer("web", { image: "image:1" });
    workload.service({ http: 80 });
    h.vpa(workload);
    assert.deepEqual(await kinds(h), [
      "ConfigMap/one",
      "Deployment/web",
      "Service/web",
      "VerticalPodAutoscaler/web",
    ]);
  });

  test("builds a workload when the app finishes, so later containers are included", async () => {
    const h = new App("web", "/apps/web");
    const workload = h.statefulSet("web");
    workload.addContainer("first", { image: "image:1" });
    workload.addContainer("second", { image: "image:2" });
    const [object] = await h.objects();
    assert.deepEqual(
      object.spec.template.spec.containers.map((c: any) => c.name),
      ["first", "second"],
    );
  });

  test("builds a route when the app finishes, so later matches are included", async () => {
    const h = new App("web", "/apps/web");
    const service = h.deployment("web").service({ http: 80 });
    const route = h.httpRoute("family", "web.fiola.dev");
    route.match(service, 80, { path: "/a" });
    route.match(service, 80, { path: "/b" });
    const http = (await h.objects()).find((o) => o.kind === "HTTPRoute")!;
    assert.deepEqual(
      http.spec.rules.map((r: any) => r.matches[0].path.value),
      ["/a", "/b"],
    );
    assert.ok((await kinds(h)).includes("ListenerSet/web.fiola.dev"));
  });

  test("registers tcp routes and the vpa of a workload or a plain target", async () => {
    const h = new App("web", "/apps/web");
    const workload = h.deployment("web");
    h.tcpRoute(
      "family",
      "web.fiola.dev",
      9000,
      { kind: "Service", name: "web" },
      9000,
    );
    h.vpa(workload);
    h.vpa(
      { kind: "Rollout", name: "x", apiVersion: "argoproj.io/v1alpha1" },
      { advisory: true },
    );
    const objects = await h.objects();
    assert.ok(objects.some((o) => o.kind === "TCPRoute"));
    const vpas = objects.filter((o) => o.kind === "VerticalPodAutoscaler");
    assert.equal(vpas[0].spec.targetRef.apiVersion, "apps/v1");
    assert.equal(vpas[1].spec.targetRef.apiVersion, "argoproj.io/v1alpha1");
    assert.equal(vpas[1].spec.updatePolicy.updateMode, "Off");
  });

  test("secrets use the app's own name, and expose the key references apps need", async () => {
    const h = new App("web", "/apps/web");
    h.secrets();
    assert.deepEqual(await kinds(h), [
      "ServiceAccount/vault-secrets-operator",
      "VaultAuth/web",
      "VaultStaticSecret/secrets",
    ]);
    assert.deepEqual(h.secretKey("token"), {
      secretKeyRef: { name: "secrets", key: "token" },
    });
    assert.match(h.secretRef("token"), /"token"/);

    const templated = new App("mail", "/apps/mail");
    templated.templatedSecrets({ PASSWORD: templated.secretRef("smtp") });
    assert.equal((await templated.objects())[2].kind, "VaultDynamicSecret");
  });

  test("configMap registers the object and returns it; files reads from the app's directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.conf"), "hello\n");
    const h = new App("web", dir);
    const config = h.configMap("web-config", h.files("a.conf"));
    assert.equal(config.metadata.name, "web-config");
    assert.deepEqual(config.data, { "a.conf": "hello\n" });
    assert.deepEqual(await kinds(h), ["ConfigMap/web-config"]);
  });

  test("nasVolume adds a volume and its claim", async () => {
    const h = new App("web", "/apps/web");
    h.nasVolume("media");
    assert.deepEqual(await kinds(h), [
      "PersistentVolume/media",
      "PersistentVolumeClaim/media",
    ]);
  });
});

describe("App.namespace", () => {
  test("creates the app's namespace, privileged on request", async () => {
    const [plain] = await new App("web", "/apps/web").namespace().objects();
    assert.deepEqual(plain.metadata, { name: "web" });
    const [privileged] = await new App("web", "/apps/web")
      .namespace({ privileged: true })
      .objects();
    assert.equal(
      privileged.metadata.labels["pod-security.kubernetes.io/enforce"],
      "privileged",
    );
  });
});

describe("App.manifest and App.edit", () => {
  const write = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  };

  const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  template:
    spec:
      containers:
        - name: web
          image: web:1
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: web
subjects:
  - kind: ServiceAccount
    name: web
    namespace: default
`;

  test("adds the objects of a manifest in the app's directory, without waiting", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "after" } });
    assert.deepEqual(await kinds(h), [
      "Deployment/web",
      "ServiceAccount/web",
      "ClusterRoleBinding/web",
      "ConfigMap/after",
    ]);
  });

  test("a manifest can be moved into the app's namespace, with what refers to it", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml", { namespace: true });
    const objects = await h.objects();
    assert.deepEqual(
      objects.map((o) => o.metadata.namespace),
      ["web", "web", "web"],
    );
    assert.equal(objects[2].subjects[0].namespace, "web");
  });

  test("a manifest can add labels, selectors included", async () => {
    const dir = write({ "manifest.yaml": deployment });
    const h = new App("web", dir);
    h.manifest("manifest.yaml", {
      labels: { "app.kubernetes.io/name": "web" },
    });
    const [d] = await h.objects();
    assert.equal(d.metadata.labels["app.kubernetes.io/name"], "web");
    assert.equal(d.spec.selector.matchLabels["app.kubernetes.io/name"], "web");
    assert.equal(
      d.spec.template.metadata.labels["app.kubernetes.io/name"],
      "web",
    );
  });

  test("a missing manifest fails when the app is built, not when it is declared", async () => {
    const h = new App("web", write({}));
    h.manifest("missing.yaml");
    await assert.rejects(() => h.objects(), /missing\.yaml/);
  });

  test("edits change the objects they select, whatever added them", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.edit({ kind: "Deployment", name: "web" }, (d) => {
      d.spec.template.spec.containers[0].image = "web:2";
    });
    h.manifest("manifest.yaml");
    const [d] = await h.objects();
    assert.equal(d.spec.template.spec.containers[0].image, "web:2");
  });

  test("edits don't accumulate when the objects are read twice", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.edit({ kind: "Deployment", name: "web" }, (d) => {
      d.spec.template.spec.containers.push({ name: "extra" });
    });
    await h.objects();
    const [d] = await h.objects();
    assert.equal(d.spec.template.spec.containers.length, 2);
  });

  test("an edit that selects nothing is an error, so a changed upstream is noticed", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.edit({ kind: "Deployment", name: "renamed" }, () => {});
    await assert.rejects(
      () => h.objects(),
      /edit matched no object \(Deployment\/renamed\)/,
    );
  });

  test("an edit can select by api group", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.edit({ kind: "Deployment", name: "web", group: "extensions" }, () => {});
    await assert.rejects(() => h.objects(), /matched no object/);
  });
});

describe("App.jsonnet", () => {
  test("evaluates a jsonnet file in the app's directory, and the app uses the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    writeFileSync(join(dir, "main.jsonnet"), "{ names: ['a', 'b'] }");
    const h = new App("web", dir);
    for (const name of (await h.jsonnet("main.jsonnet")).names) {
      h.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name } });
    }
    assert.deepEqual(await kinds(h), ["ConfigMap/a", "ConfigMap/b"]);
  });
});

describe("App.apps", () => {
  test("lists the apps beside this one by name, with the generated crds app", () => {
    const root = mkdtempSync(join(tmpdir(), "apps-"));
    dirs.push(root);
    for (const name of ["web", "db", "cache"]) {
      mkdirSync(join(root, name));
    }
    writeFileSync(join(root, "package.json"), "{}");
    assert.deepEqual(new App("web", join(root, "web")).apps, [
      "cache",
      "crds",
      "db",
      "web",
    ]);
  });
});
