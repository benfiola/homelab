import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editor } from "./edit.ts";
import {
  dashboard,
  podMonitor,
  Service,
  serviceMonitor,
} from "./monitoring.ts";
import { Workload } from "./workload.ts";

const collect = () => {
  const objects: any[] = [];
  return { objects, sink: (o: any) => objects.push(o) };
};

describe("monitors", () => {
  test("a pod monitor scrapes a named container port", () => {
    const m = podMonitor("x", { app: "x" }, "metrics", { interval: "15s" });
    assert.equal(m.kind, "PodMonitor");
    assert.deepEqual(m.spec.selector.matchLabels, { app: "x" });
    assert.deepEqual(m.spec.podMetricsEndpoints, [
      { port: "metrics", interval: "15s" },
    ]);
  });

  test("dropMetrics drops series by metric name", () => {
    const m = podMonitor("x", { app: "x" }, "metrics", { dropMetrics: "a|b" });
    assert.deepEqual(m.spec.podMetricsEndpoints[0].metricRelabelings, [
      { action: "drop", sourceLabels: ["__name__"], regex: "a|b" },
    ]);
  });

  test("https skips verification, as in-cluster certificates are self-signed", () => {
    const m = serviceMonitor("x", { app: "x" }, "https", { https: true });
    assert.deepEqual(m.spec.endpoints, [
      {
        port: "https",
        scheme: "https",
        tlsConfig: { insecureSkipVerify: true },
      },
    ]);
  });
});

describe("Workload.podMonitor", () => {
  test("selects the workload's pods", () => {
    const { objects, sink } = collect();
    new Workload("Deployment", "web", {}, sink).podMonitor("http");
    assert.equal(objects[0].kind, "PodMonitor");
    assert.equal(objects[0].metadata.name, "web");
    assert.deepEqual(objects[0].spec.selector.matchLabels, {
      "app.kubernetes.io/name": "web",
    });
  });
});

describe("Service.serviceMonitor", () => {
  test("labels a service made by a workload, and selects it by that label", () => {
    const { objects, sink } = collect();
    new Workload("Deployment", "web", {}, sink)
      .service({ metrics: 9090 })
      .serviceMonitor("metrics");
    const [service, monitor] = objects;
    assert.deepEqual(service.metadata.labels, {
      "app.kubernetes.io/name": "web",
    });
    assert.deepEqual(monitor.spec.selector.matchLabels, {
      "app.kubernetes.io/name": "web",
    });
  });

  test("selects a found service by its labels, leaving out those a chart upgrade changes", () => {
    const { objects, sink } = collect();
    const obj = {
      kind: "Service",
      metadata: {
        name: "s",
        labels: {
          "app.kubernetes.io/name": "s",
          "helm.sh/chart": "s-1.0.0",
          "app.kubernetes.io/version": "1",
        },
      },
      spec: { ports: [{ name: "http", port: 80 }] },
    };
    new Service(obj, sink).serviceMonitor("http");
    assert.deepEqual(objects[0].spec.selector.matchLabels, {
      "app.kubernetes.io/name": "s",
    });
  });

  test("rejects a port the service doesn't have", () => {
    const { sink } = collect();
    assert.throws(
      () =>
        new Workload("Deployment", "web", {}, sink)
          .service({ http: 80 })
          .serviceMonitor("metrics"),
      /no port named 'metrics'/,
    );
  });
});

describe("dashboard", () => {
  const configMap = (name: string, files: Record<string, unknown>) => ({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name },
    data: Object.fromEntries(
      Object.entries(files).map(([file, json]) => [file, JSON.stringify(json)]),
    ),
  });
  const edit = (objects: any[], names: string | string[], fn: any) =>
    dashboard(editor(objects), names, fn);

  test("replace changes text literally, everywhere, in every file", () => {
    const map = configMap("a", {
      "1.json": { expr: 'up{job="x"} + up{job="x"}' },
      "2.json": { expr: 'up{job="x"}' },
    });
    edit([map], "a", (d: any) => d.replace('job=\\"x\\"', 'job=\\"$1.*\\"'));
    assert.equal(
      map.data["1.json"],
      '{"expr":"up{job=\\"$1.*\\"} + up{job=\\"$1.*\\"}"}',
    );
    assert.equal(map.data["2.json"], '{"expr":"up{job=\\"$1.*\\"}"}');
  });

  test("operations apply in order", () => {
    const map = configMap("a", { "a.json": { e: "r-read.* r-read" } });
    edit([map], "a", (d: any) =>
      d.replace("r-read.*", "r-[0-9]+").replace("r-read", "r"),
    );
    assert.equal(map.data["a.json"], '{"e":"r-[0-9]+ r"}');
  });

  test("a replacement that matches in none of the maps is an error, and in only one is fine", () => {
    const a = configMap("a", { "a.json": { e: "foo" } });
    const b = configMap("b", { "b.json": { e: "bar" } });
    edit([a, b], ["a", "b"], (d: any) => d.replace("foo", "baz"));
    assert.equal(a.data["a.json"], '{"e":"baz"}');
    assert.throws(
      () => edit([a, b], ["a", "b"], (d: any) => d.replace("nope", "x")),
      /replace 'nope' matches nothing in the dashboards of a, b/,
    );
  });

  test("a map that isn't there is an error", () => {
    assert.throws(() => edit([], "a", () => {}), /no object matches/);
  });

  test("dropPanels removes panels by exact title, wherever they are", () => {
    const map = configMap("a", {
      "a.json": {
        panels: [
          { title: "keep" },
          { title: "gone" },
          { title: "also gone" },
          {
            type: "row",
            title: "r",
            panels: [{ title: "gone" }, { title: "keep" }],
          },
        ],
        rows: [
          { title: "old", panels: [{ title: "gone" }, { title: "keep" }] },
        ],
      },
    });
    edit([map], "a", (d: any) => d.dropPanels("gone", "also gone"));
    assert.deepEqual(JSON.parse(map.data["a.json"]), {
      panels: [
        { title: "keep" },
        { type: "row", title: "r", panels: [{ title: "keep" }] },
      ],
      rows: [{ title: "old", panels: [{ title: "keep" }] }],
    });
  });

  test("a title that is nowhere is an error, and so is a part of one", () => {
    const map = configMap("a", {
      "a.json": { panels: [{ title: "Bigtable Latency" }, { title: "ok" }] },
    });
    assert.throws(
      () => edit([map], "a", (d: any) => d.dropPanels("Bigtable")),
      /dropPanels 'Bigtable' matches nothing/,
    );
    assert.throws(
      () => edit([map], "a", (d: any) => d.dropPanels("ok", "missing")),
      /dropPanels 'missing' matches nothing/,
    );
  });

  test("dropPanels doesn't remove a row of that name", () => {
    const map = configMap("a", {
      "a.json": { panels: [{ type: "row", title: "x", panels: [] }] },
    });
    assert.throws(
      () => edit([map], "a", (d: any) => d.dropPanels("x")),
      /matches nothing/,
    );
  });

  test("dropRows removes rows with their panels, collapsed or not", () => {
    const map = configMap("a", {
      "a.json": {
        panels: [
          { title: "top" },
          { type: "row", title: "gone", panels: [{ title: "in" }] },
          { type: "row", title: "gone too" },
          { title: "follows" },
          { type: "row", title: "kept" },
          { title: "kept panel" },
        ],
        rows: [{ title: "gone", panels: [] }, { title: "other" }],
      },
    });
    edit([map], "a", (d: any) => d.dropRows("gone", "gone too"));
    assert.deepEqual(JSON.parse(map.data["a.json"]), {
      panels: [
        { title: "top" },
        { type: "row", title: "kept" },
        { title: "kept panel" },
      ],
      rows: [{ title: "other" }],
    });
  });

  test("dropDashboards removes files, and a file that isn't there is an error", () => {
    const map = configMap("a", { "a.json": {}, "b.json": {}, "c.json": {} });
    edit([map], "a", (d: any) => d.dropDashboards("a.json", "b.json"));
    assert.deepEqual(Object.keys(map.data), ["c.json"]);
    assert.throws(
      () => edit([map], "a", (d: any) => d.dropDashboards("a.json")),
      /dropDashboards 'a.json' matches nothing/,
    );
  });
});
