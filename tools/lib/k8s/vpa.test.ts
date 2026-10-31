import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { vpa } from "./vpa.ts";

describe("vpa", () => {
  test("targets a workload, which is in apps/v1", () => {
    const v = vpa({ kind: "StatefulSet", name: "db" });
    assert.deepEqual(v.spec.targetRef, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "db",
    });
    assert.equal(v.metadata.name, "db");
    assert.equal(v.spec.updatePolicy.updateMode, "InPlaceOrRecreate");
  });

  test("targets anything else by the apiVersion it is given", () => {
    const v = vpa({
      kind: "Rollout",
      name: "r",
      apiVersion: "argoproj.io/v1alpha1",
    });
    assert.equal(v.spec.targetRef.apiVersion, "argoproj.io/v1alpha1");
  });

  test("only recommends, when advisory", () => {
    assert.equal(
      vpa({ kind: "Deployment", name: "d" }, { advisory: true }).spec
        .updatePolicy.updateMode,
      "Off",
    );
  });

  test("is in the namespace it is given, and otherwise in none", () => {
    assert.equal(
      vpa({ kind: "Deployment", name: "d" }, { namespace: "other" }).metadata
        .namespace,
      "other",
    );
    assert.equal(
      "namespace" in vpa({ kind: "Deployment", name: "d" }).metadata,
      false,
    );
  });
});
