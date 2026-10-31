import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { helm, isDeleteHook, parseChartUrl } from "./helm.ts";

const hasHelm = (() => {
  try {
    execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("isDeleteHook", () => {
  const hook = (value: string) => ({
    metadata: { annotations: { "helm.sh/hook": value } },
  });

  test("is true for hooks that only run on delete", () => {
    assert.ok(isDeleteHook(hook("pre-delete")));
    assert.ok(isDeleteHook(hook("pre-delete, post-delete")));
  });

  test("is false for anything else", () => {
    assert.ok(!isDeleteHook(hook("pre-install")));
    assert.ok(!isDeleteHook(hook("pre-delete,pre-install")));
    assert.ok(!isDeleteHook({ metadata: {} }));
  });
});

// a chart that is already in the cache is not downloaded, so a tiny local one stands in for a repository
describe("helm", { skip: !hasHelm && "helm is not installed" }, () => {
  const cache = mkdtempSync(join(tmpdir(), "helm-cache-"));
  dirs.push(cache);
  process.env.HOMELAB_CACHE = cache;

  const chart = join(cache, "charts", "example.test", "demo-1.0.0");
  mkdirSync(join(chart, "templates"), { recursive: true });
  writeFileSync(
    join(chart, "Chart.yaml"),
    "apiVersion: v2\nname: demo\nversion: 1.0.0\n",
  );
  writeFileSync(join(chart, "values.yaml"), "greeting: hello\n");
  writeFileSync(
    join(chart, "templates", "config.yaml"),
    `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}
  namespace: {{ .Release.Namespace }}
data:
  greeting: {{ .Values.greeting }}
  kube: {{ .Capabilities.KubeVersion.Version }}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: cleanup
  annotations:
    helm.sh/hook: pre-delete
`,
  );
  mkdirSync(join(chart, "crds"));
  writeFileSync(
    join(chart, "crds", "crd.yaml"),
    "apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\nmetadata:\n  name: demos.example.test\n",
  );

  const options = {
    repo: "https://example.test",
    chart: "demo",
    version: "1.0.0",
  };

  test("renders a chart with the release name, namespace and kubernetes version", async () => {
    const objects = await helm(options, "team");
    const config = objects.find((o) => o.kind === "ConfigMap")!;
    assert.equal(config.metadata.name, "demo");
    assert.equal(config.metadata.namespace, "team");
    assert.equal(config.data.greeting, "hello");
    assert.equal(config.data.kube, "v1.34.0");
  });

  test("takes a release name and values files", async () => {
    const values = join(cache, "values.yaml");
    writeFileSync(values, "greeting: hi\n");
    const objects = await helm(
      { ...options, release: "other", values: [values] },
      "team",
    );
    const config = objects.find((o) => o.kind === "ConfigMap")!;
    assert.equal(config.metadata.name, "other");
    assert.equal(config.data.greeting, "hi");
  });

  test("drops hooks that only run on delete", async () => {
    const objects = await helm(options, "team");
    assert.ok(!objects.some((o) => o.kind === "Job"));
  });

  test("includes the chart's crds unless told not to", async () => {
    assert.ok(
      (await helm(options, "team")).some(
        (o) => o.kind === "CustomResourceDefinition",
      ),
    );
    assert.ok(
      !(await helm({ ...options, crds: false }, "team")).some(
        (o) => o.kind === "CustomResourceDefinition",
      ),
    );
  });
});

describe("parseChartUrl", () => {
  test("reads an oci chart", () => {
    assert.deepEqual(
      parseChartUrl(
        "oci://quay.io/jetstack/charts/cert-manager?version=v1.21.3",
      ),
      {
        repo: "oci://quay.io/jetstack/charts",
        chart: "cert-manager",
        version: "v1.21.3",
      },
    );
  });

  test("reads a chart in an http repository, whose url is the repository's with the chart's name added", () => {
    assert.deepEqual(
      parseChartUrl("https://helm.cilium.io/cilium?version=1.20.1"),
      {
        repo: "https://helm.cilium.io",
        chart: "cilium",
        version: "1.20.1",
      },
    );
    assert.deepEqual(
      parseChartUrl("https://example.test/a/b/charts/demo?version=0.1.0"),
      {
        repo: "https://example.test/a/b/charts",
        chart: "demo",
        version: "0.1.0",
      },
    );
  });

  test("a chart needs a repository, a name and a version, and nothing else", () => {
    for (const bad of [
      "oci://quay.io/cert-manager",
      "https://helm.cilium.io/cilium",
      "https://helm.cilium.io/cilium?ref=1.0.0",
      "https://helm.cilium.io/cilium?version=1.0.0&extra=1",
      "cilium?version=1.0.0",
      "https://helm.cilium.io?version=1.0.0",
    ]) {
      assert.throws(
        () => parseChartUrl(bad),
        /expected '<repository url>\/<chart>\?version=<version>'/,
        bad,
      );
    }
  });
});
