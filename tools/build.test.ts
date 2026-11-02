import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { parseAllDocuments } from "yaml";
import { build } from "./build.ts";

const roots: string[] = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const crd = (name: string, extra = "") => `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${name}
${extra}`;

const configMap = (name: string, namespace = "ns") => `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}
  namespace: ${namespace}
`;

interface App {
  manifest?: string;
  appTs?: string | null;
}

// a workspace of apps. by default an app's app.ts adds the objects of its manifest.yaml.
const workspace = (apps: Record<string, App | string>) => {
  const root = mkdtempSync(join(tmpdir(), "build-"));
  roots.push(root);

  for (const [name, app] of Object.entries(apps)) {
    const spec: App = typeof app === "string" ? { manifest: app } : app;
    const dir = join(root, "apps", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.yaml"), spec.manifest ?? "");
    if (spec.appTs !== null) {
      writeFileSync(
        join(dir, "app.ts"),
        spec.appTs ??
          'export const app = (h) => { h.manifest("manifest.yaml"); };\n',
      );
    }
  }
  return {
    root,
    opts: { appsDir: join(root, "apps"), outDir: join(root, "out") },
  };
};

const docs = (file: string) =>
  parseAllDocuments(readFileSync(file, "utf-8"))
    .map((d) => d.toJSON())
    .filter(Boolean);

const names = (file: string) =>
  docs(file).map((o) => `${o.kind}/${o.metadata.name}`);

describe("build", () => {
  test("renders every app into <out>/apps/<app>", async () => {
    const { root, opts } = workspace({ a: configMap("a"), b: configMap("b") });
    const result = await build(opts);
    assert.equal(result.built, 2);
    assert.equal(result.failures.length, 0);
    assert.deepEqual(names(join(root, "out/apps/a/manifest.yaml")), [
      "ConfigMap/a",
    ]);
    assert.match(
      readFileSync(join(root, "out/apps/b/kustomization.yaml"), "utf-8"),
      /order: fifo/,
    );
  });

  test("reports failures per app and still builds the rest", async () => {
    const { root, opts } = workspace({
      a: configMap("a"),
      b: { appTs: 'export const app = () => { throw new Error("boom"); };\n' },
    });
    const result = await build(opts);
    assert.equal(result.built, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].app, "b");
    assert.match(result.failures[0].message, /boom/);
    assert.ok(existsSync(join(root, "out/apps/a/manifest.yaml")));
  });

  test("an app without an app.ts fails, and says why", async () => {
    const { opts } = workspace({
      a: { manifest: configMap("a"), appTs: null },
    });
    const result = await build(opts);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].app, "a");
    assert.match(result.failures[0].message, /has no app.ts/);
  });

  test("an app.ts without an 'app' export fails, and says why", async () => {
    const { opts } = workspace({ a: { appTs: "export const other = 1;\n" } });
    const result = await build(opts);
    assert.match(result.failures[0].message, /expected an export named 'app'/);
  });

  test("removes apps that no longer exist", async () => {
    const { root, opts } = workspace({ a: configMap("a") });
    mkdirSync(join(root, "out/apps/stale"), { recursive: true });
    await build(opts);
    assert.ok(!existsSync(join(root, "out/apps/stale")));
  });

  test("an object without a name fails its app", async () => {
    const { opts } = workspace({ a: "apiVersion: v1\nkind: ConfigMap\n" });
    const result = await build(opts);
    assert.match(result.failures[0].message, /no 'metadata.name'/);
  });
});

// flux applies a namespace-less object to 'default', and its inventory id includes the namespace (see lib/app.ts)
describe("namespaces", () => {
  const clusterRole =
    "apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata:\n  name: cr\n";

  test("objects without a namespace get the app's, cluster-scoped ones too", async () => {
    const { root, opts } = workspace({
      a: `${clusterRole}---\n${configMap("c", "other")}`,
    });
    await build(opts);
    assert.deepEqual(
      docs(join(root, "out/apps/a/manifest.yaml")).map(
        (o) => o.metadata.namespace,
      ),
      ["a", "other"],
    );
  });

  test("an app can name a namespace other than its own", async () => {
    const { root, opts } = workspace({
      a: {
        manifest: clusterRole,
        appTs:
          'export const app = (h) => { h.namespaceName = "team"; h.manifest("manifest.yaml"); };\n',
      },
    });
    await build(opts);
    assert.equal(
      docs(join(root, "out/apps/a/manifest.yaml"))[0].metadata.namespace,
      "team",
    );
  });
});

describe("crds", () => {
  test("are pulled out of the app and into the crds app, sorted by name", async () => {
    const { root, opts } = workspace({
      a: `${configMap("a")}---\n${crd("z.example.com")}---\n${crd("b.example.com")}`,
    });
    const result = await build(opts);
    assert.deepEqual(names(join(root, "out/apps/a/manifest.yaml")), [
      "ConfigMap/a",
    ]);
    assert.deepEqual(names(join(root, "out/apps/crds/manifest.yaml")), [
      "CustomResourceDefinition/b.example.com",
      "CustomResourceDefinition/z.example.com",
    ]);
    assert.equal(result.crds.total, 2);
  });

  test("are deduplicated across apps", async () => {
    const { root, opts } = workspace({
      a: crd("x.example.com"),
      b: crd("x.example.com"),
    });
    const result = await build(opts);
    assert.equal(result.crds.total, 1);
    assert.equal(result.crds.conflicts.length, 0);
    assert.equal(names(join(root, "out/apps/crds/manifest.yaml")).length, 1);
  });

  test("a crd two apps ship differently is reported, and the app that sorts last wins", async () => {
    const { root, opts } = workspace({
      a: crd("x.example.com", "  labels:\n    v: old\n"),
      b: crd("x.example.com", "  labels:\n    v: new\n"),
    });
    const result = await build(opts);
    assert.deepEqual(result.crds.conflicts, ["x.example.com"]);
    assert.match(
      readFileSync(join(root, "out/apps/crds/manifest.yaml"), "utf-8"),
      /v: new/,
    );
  });

  test("a crd two apps ship identically is not a conflict", async () => {
    const { opts } = workspace({
      a: crd("x.example.com"),
      b: crd("x.example.com"),
    });
    assert.deepEqual((await build(opts)).crds.conflicts, []);
  });

  test("differing only in key order is not a conflict", async () => {
    const a =
      "apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\nmetadata:\n  name: x.example.com\nspec:\n  group: example.com\n  scope: Cluster\n";
    const b =
      "spec:\n  scope: Cluster\n  group: example.com\nmetadata:\n  name: x.example.com\nkind: CustomResourceDefinition\napiVersion: apiextensions.k8s.io/v1\n";
    const { opts } = workspace({ a, b });
    assert.deepEqual((await build(opts)).crds.conflicts, []);
  });

  // deployed crds are in the namespace 'crds': a different one changes flux's inventory id, and flux prunes them
  test("every crd carries the 'crds' namespace, wherever it came from", async () => {
    const { root, opts } = workspace({
      a: crd("x.example.com", "  namespace: other\n"),
      b: `${crd("y.example.com")}`,
    });
    const result = await build(opts);
    assert.deepEqual(result.crds.conflicts, []);
    const namespaces = docs(join(root, "out/apps/crds/manifest.yaml")).map(
      (o) => o.metadata.namespace,
    );
    assert.deepEqual(namespaces, ["crds", "crds"]);
  });

  test("an app that is only crds builds to an empty manifest", async () => {
    const { root, opts } = workspace({ a: crd("x.example.com") });
    await build(opts);
    assert.equal(
      readFileSync(join(root, "out/apps/a/manifest.yaml"), "utf-8"),
      "",
    );
    assert.ok(existsSync(join(root, "out/apps/a/kustomization.yaml")));
  });

  test("apps/crds is generated, so an app by that name is an error", async () => {
    const { opts } = workspace({ crds: crd("x.example.com") });
    const result = await build(opts);
    assert.match(result.failures[0].message, /apps\/crds is generated/);
  });
});
