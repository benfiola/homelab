import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stampNamespace, tidy, validate } from "./finalize.ts";

describe("tidy", () => {
  test("drops a null creationTimestamp", () => {
    assert.deepEqual(
      tidy([{ metadata: { name: "x", creationTimestamp: null } }]),
      [{ metadata: { name: "x" } }],
    );
  });

  test("drops empty labels and annotations, which carry nothing", () => {
    assert.deepEqual(
      tidy([{ metadata: { name: "x", labels: {}, annotations: {} } }]),
      [{ metadata: { name: "x" } }],
    );
  });

  test("keeps everything else", () => {
    const obj = {
      metadata: {
        name: "x",
        labels: { a: "b" },
        creationTimestamp: "2020-01-01T00:00:00Z",
      },
    };
    assert.deepEqual(tidy([obj]), [obj]);
  });
});

describe("stampNamespace", () => {
  test("stamps objects without a namespace, cluster-scoped ones included", () => {
    const stamped = stampNamespace(
      [
        { kind: "ClusterRole", metadata: { name: "a" } },
        { kind: "ConfigMap", metadata: { name: "b", namespace: "other" } },
      ],
      "app",
    );
    assert.deepEqual(
      stamped.map((o) => o.metadata.namespace),
      ["app", "other"],
    );
  });
});

describe("validate", () => {
  test("accepts objects with a kind, an apiVersion and a name", () => {
    const objects = [
      { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "x" } },
    ];
    assert.equal(validate("app.ts", objects), objects);
  });

  test("names the origin and the problem", () => {
    assert.throws(
      () =>
        validate("app.ts", [{ kind: "ConfigMap", metadata: { name: "x" } }]),
      /app\.ts: object 0 has no 'apiVersion'/,
    );
    assert.throws(
      () =>
        validate("app.ts", [
          { apiVersion: "v1", kind: "ConfigMap", metadata: {} },
        ]),
      /ConfigMap \(object 0\) has no 'metadata.name'/,
    );
  });
});
