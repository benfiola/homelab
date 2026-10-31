import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addLabels } from "./labels.ts";

const pairs = { "app.kubernetes.io/name": "web" };

describe("addLabels", () => {
  test("labels the object", () => {
    const obj = addLabels(
      { kind: "ConfigMap", metadata: { name: "x" } },
      pairs,
    );
    assert.deepEqual(obj.metadata.labels, pairs);
  });

  test("keeps the labels it has", () => {
    const obj = addLabels(
      { kind: "ConfigMap", metadata: { name: "x", labels: { a: "b" } } },
      pairs,
    );
    assert.deepEqual(obj.metadata.labels, { a: "b", ...pairs });
  });

  test("labels a workload's selector and pod template, so they still match", () => {
    const obj = addLabels(
      {
        kind: "Deployment",
        metadata: { name: "x" },
        spec: {
          selector: { matchLabels: { app: "x" } },
          template: { metadata: { labels: { app: "x" } } },
        },
      },
      pairs,
    );
    assert.deepEqual(obj.spec.selector.matchLabels, { app: "x", ...pairs });
    assert.deepEqual(obj.spec.template.metadata.labels, { app: "x", ...pairs });
  });

  test("creates the selector and template labels a workload lacks", () => {
    const obj = addLabels(
      { kind: "DaemonSet", metadata: { name: "x" }, spec: { template: {} } },
      pairs,
    );
    assert.deepEqual(obj.spec.selector.matchLabels, pairs);
    assert.deepEqual(obj.spec.template.metadata.labels, pairs);
  });

  test("creates the pod template labels of a job, a cron job and a replication controller", () => {
    const job = addLabels(
      { kind: "Job", metadata: { name: "x" }, spec: { template: {} } },
      pairs,
    );
    assert.deepEqual(job.spec.template.metadata.labels, pairs);
    const cron = addLabels(
      {
        kind: "CronJob",
        metadata: { name: "x" },
        spec: { jobTemplate: { spec: { template: {} } } },
      },
      pairs,
    );
    assert.deepEqual(cron.spec.jobTemplate.metadata.labels, pairs);
    assert.deepEqual(
      cron.spec.jobTemplate.spec.template.metadata.labels,
      pairs,
    );
    const controller = addLabels(
      {
        kind: "ReplicationController",
        metadata: { name: "x" },
        spec: { template: {} },
      },
      pairs,
    );
    assert.deepEqual(controller.spec.selector, pairs);
    assert.deepEqual(controller.spec.template.metadata.labels, pairs);
  });

  test("labels a service's selector", () => {
    const obj = addLabels(
      {
        kind: "Service",
        metadata: { name: "x" },
        spec: { selector: { app: "x" } },
      },
      pairs,
    );
    assert.deepEqual(obj.spec.selector, { app: "x", ...pairs });
  });

  test("labels a statefulset's volume claims", () => {
    const obj = addLabels(
      {
        kind: "StatefulSet",
        metadata: { name: "x" },
        spec: {
          volumeClaimTemplates: [
            { metadata: { name: "a" } },
            { metadata: { name: "b" } },
          ],
        },
      },
      pairs,
    );
    assert.deepEqual(
      obj.spec.volumeClaimTemplates.map((c: any) => c.metadata.labels),
      [pairs, pairs],
    );
  });

  test("only touches optional selectors that exist", () => {
    const obj = addLabels(
      { kind: "PodDisruptionBudget", metadata: { name: "x" }, spec: {} },
      pairs,
    );
    assert.equal(obj.spec.selector, undefined);
  });

  test("leaves the spec of other kinds alone", () => {
    const obj = addLabels(
      { kind: "Role", metadata: { name: "x" }, rules: [] },
      pairs,
    );
    assert.deepEqual(obj, {
      kind: "Role",
      metadata: { name: "x", labels: pairs },
      rules: [],
    });
  });
});
