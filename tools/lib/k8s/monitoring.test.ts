import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { podMonitor, Service, serviceMonitor } from "./monitoring.ts";
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
