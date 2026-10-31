import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { compare, diffValues, type Allowance } from "./parity.ts";

const roots: string[] = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// builds <root>/apps/<app>/manifest.yaml from a map of app -> yaml
const tree = (apps: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "parity-"));
  roots.push(root);
  for (const [app, yaml] of Object.entries(apps)) {
    const dir = join(root, "apps", app);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.yaml"), yaml);
    writeFileSync(
      join(dir, "kustomization.yaml"),
      "resources:\n  - manifest.yaml\n",
    );
  }
  return root;
};

const configMap = (value: string, extra = "") => `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
  namespace: ns
${extra}data:
  key: ${value}
`;

const deployment = (selector: string) => `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ns
spec:
  selector:
    matchLabels:
      app: ${selector}
  template:
    metadata:
      labels:
        app: ${selector}
`;

const pvc = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
  namespace: ns
spec:
  storageClassName: standard
`;

const allowance = (partial: Partial<Allowance>): Allowance => ({
  app: "a",
  object: "/ConfigMap/ns/cm",
  reason: "test",
  used: 0,
  ...partial,
});

describe("diffValues", () => {
  test("reports added, removed and changed fields as json pointers", () => {
    const diffs = diffValues(
      { a: 1, b: { c: [1, 2] }, "x/y": true },
      { a: 2, b: { c: [1] }, d: 1 },
    );
    assert.deepEqual(
      diffs.map((d) => [d.type, d.pointer]),
      [
        ["changed", "/a"],
        ["removed", "/b/c/1"],
        ["added", "/d"],
        ["removed", "/x~1y"],
      ],
    );
  });
});

const policy = (rules: string[]) => `
apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: p
spec:
  endpointSelector: {}
  egress:
${rules.map((r) => `    - toCIDR: ["${r}"]`).join("\n")}
`;

describe("compare", () => {
  test("the rules of a cilium policy are a set: their order is not a difference", () => {
    const result = compare(
      tree({ a: policy(["10.0.0.1/32", "10.0.0.2/32"]) }),
      tree({ a: policy(["10.0.0.2/32", "10.0.0.1/32"]) }),
    );
    assert.equal(result.unexpected.length, 0);
  });

  test("but a missing or different rule still is", () => {
    const result = compare(
      tree({ a: policy(["10.0.0.1/32", "10.0.0.2/32"]) }),
      tree({ a: policy(["10.0.0.1/32", "10.0.0.3/32"]) }),
    );
    assert.ok(result.unexpected.length > 0);
  });

  test("identical trees have no findings", () => {
    const yaml = configMap("v");
    const result = compare(tree({ a: yaml }), tree({ a: yaml }));
    assert.equal(result.unexpected.length, 0);
    assert.equal(result.apps[0].objects, 1);
  });

  test("ignores status, creationTimestamp and kustomize config", () => {
    const withNoise = configMap(
      "v",
      "  creationTimestamp: '2020-01-01T00:00:00Z'\n",
    );
    const result = compare(
      tree({ a: configMap("v") }),
      tree({
        a: `${withNoise}\n---\napiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\n`,
      }),
    );
    assert.equal(result.unexpected.length, 0);
  });

  test("reports a changed field", () => {
    const result = compare(
      tree({ a: configMap("one") }),
      tree({ a: configMap("two") }),
    );
    assert.equal(result.unexpected.length, 1);
    assert.equal(result.unexpected[0].pointer, "/data/key");
    assert.equal(result.unexpected[0].severity, "normal");
  });

  test("reports missing and extra objects", () => {
    const result = compare(
      tree({ a: configMap("v") }),
      tree({ a: deployment("web") }),
    );
    assert.deepEqual(result.unexpected.map((f) => f.type).sort(), [
      "added",
      "removed",
    ]);
  });

  test("an app missing from actual is reported as missing objects", () => {
    const result = compare(
      tree({ a: configMap("v"), b: configMap("v") }),
      tree({ a: configMap("v") }),
    );
    assert.equal(result.unexpected.length, 1);
    assert.equal(result.unexpected[0].app, "b");
  });

  test("flags selector changes as immutable", () => {
    const result = compare(
      tree({ a: deployment("web") }),
      tree({ a: deployment("api") }),
    );
    assert.ok(result.unexpected.length > 0);
    assert.ok(
      result.unexpected.every(
        (f) =>
          f.pointer !== "/spec/selector/matchLabels/app" ||
          f.severity === "immutable",
      ),
    );
    const selector = result.unexpected.find((f) =>
      f.pointer.startsWith("/spec/selector"),
    );
    assert.equal(selector?.severity, "immutable");
    const template = result.unexpected.find((f) =>
      f.pointer.startsWith("/spec/template"),
    );
    assert.equal(template?.severity, "normal");
  });

  test("flags removal of a persistent volume claim as destructive", () => {
    const result = compare(tree({ a: pvc }), tree({ a: configMap("v") }));
    const removed = result.unexpected.find((f) => f.type === "removed");
    assert.equal(removed?.severity, "destructive");
  });

  test("an allowance accepts matching findings and counts as used", () => {
    const a = allowance({ path: "/data" });
    const result = compare(
      tree({ a: configMap("one") }),
      tree({ a: configMap("two") }),
      { allowances: [a] },
    );
    assert.equal(result.unexpected.length, 0);
    assert.equal(result.stale.length, 0);
    assert.equal(a.used, 1);
  });

  test("an allowance does not cover other paths", () => {
    const result = compare(
      tree({ a: configMap("one") }),
      tree({ a: configMap("two") }),
      { allowances: [allowance({ path: "/metadata" })] },
    );
    assert.equal(result.unexpected.length, 1);
    assert.equal(result.stale.length, 1);
  });

  test("an allowance that matches nothing is stale", () => {
    const yaml = configMap("v");
    const result = compare(tree({ a: yaml }), tree({ a: yaml }), {
      allowances: [allowance({})],
    });
    assert.equal(result.stale.length, 1);
  });

  // flux's inventory id includes the namespace: a different namespace is a different object, and flux would apply the new one and prune the old
  test("the namespace on a cluster-scoped object is part of its identity", () => {
    const namespaceObject = (ns: string) =>
      `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: team\n${ns}`;
    const result = compare(
      tree({ a: namespaceObject("  namespace: team\n") }),
      tree({ a: namespaceObject("") }),
    );
    assert.deepEqual(
      result.unexpected.map((f) => `${f.type}:${f.severity}`).sort(),
      ["added:normal", "removed:destructive"],
    );
  });

  test("treats null fields as absent, except in crds", () => {
    const withNull = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm
  namespace: ns
data:
  key: v
binaryData: null
`;
    assert.equal(
      compare(tree({ a: configMap("v") }), tree({ a: withNull })).unexpected
        .length,
      0,
    );

    const crdWith = (def: string) => `
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: x.example.com
spec:
  scope: Namespaced
${def}`;
    const result = compare(
      tree({ a: crdWith("") }),
      tree({ a: crdWith("  default: null\n") }),
    );
    assert.equal(result.unexpected.length, 1);
  });

  test("still reports the namespace on namespaced kinds", () => {
    const result = compare(
      tree({ a: configMap("v") }),
      tree({ a: configMap("v").replace("namespace: ns", "namespace: other") }),
    );
    assert.equal(result.unexpected.length, 2);
  });

  test("--app limits comparison and stale detection", () => {
    const result = compare(
      tree({ a: configMap("one"), b: configMap("one") }),
      tree({ a: configMap("two"), b: configMap("two") }),
      { apps: ["a"], allowances: [allowance({ app: "b" })] },
    );
    assert.equal(result.apps.length, 1);
    assert.equal(result.stale.length, 0);
  });
});
