import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { merge, mergeDocuments } from "./merge.ts";

describe("merge", () => {
  test("merges mappings key by key, later over earlier", () => {
    assert.deepEqual(
      merge({ a: 1, b: { c: 1, d: 2 } }, { b: { c: 3 }, e: 4 }),
      { a: 1, b: { c: 3, d: 2 }, e: 4 },
    );
  });

  test("replaces anything that isn't a mapping or a list", () => {
    assert.equal(merge("a", "b"), "b");
    assert.deepEqual(merge({ a: 1 }, "b"), "b");
    assert.deepEqual(merge([1], { a: 1 }), { a: 1 });
  });

  test("ignores values that are missing", () => {
    assert.deepEqual(merge({ a: 1 }, undefined, { b: 2 }), { a: 1, b: 2 });
    assert.deepEqual(merge({ a: { b: 1 } }, { a: undefined }), { a: { b: 1 } });
  });

  test("is nothing when there is nothing to merge", () => {
    assert.equal(merge(), undefined);
    assert.equal(merge(undefined, undefined), undefined);
  });

  test("merges list entries that share a name, and appends the rest", () => {
    const merged = merge(
      { modules: [{ name: "a", parameters: ["x"] }, { name: "b" }] },
      { modules: [{ name: "a", parameters: ["y"] }, { name: "c" }] },
    );
    assert.deepEqual(merged.modules, [
      { name: "a", parameters: ["x", "y"] },
      { name: "b" },
      { name: "c" },
    ]);
  });

  test("lists of values gain the values they lack, once", () => {
    assert.deepEqual(
      merge({ options: ["rbind", "rw"] }, { options: ["rw", "rshared"] })
        .options,
      ["rbind", "rw", "rshared"],
    );
  });

  test("entries without a name are not the same entry", () => {
    const merged = merge(
      { mounts: [{ source: "/a" }] },
      { mounts: [{ source: "/b" }] },
    );
    assert.deepEqual(merged.mounts, [{ source: "/a" }, { source: "/b" }]);
  });

  test("does not change what it merges", () => {
    const a = { list: [{ name: "x", v: 1 }] };
    merge(a, { list: [{ name: "x", v: 2 }] });
    assert.deepEqual(a, { list: [{ name: "x", v: 1 }] });
  });
});

describe("mergeDocuments", () => {
  const dhcp = (extra = {}) => ({
    apiVersion: "v1alpha1",
    kind: "DHCPv4Config",
    name: "eno1",
    ...extra,
  });

  test("merges documents with the same apiVersion, kind and name", () => {
    const merged = mergeDocuments([dhcp({ a: 1 })], [dhcp({ b: 2 })]);
    assert.deepEqual(merged, [dhcp({ a: 1, b: 2 })]);
  });

  test("appends documents that differ in any of the three", () => {
    const merged = mergeDocuments(
      [dhcp()],
      [dhcp({ name: "eno2" })],
      [{ ...dhcp(), kind: "Other" }],
    );
    assert.equal(merged.length, 3);
  });

  test("documents of the legacy format, which have none, are one document", () => {
    const generated = { version: "v1alpha1", machine: { type: "worker" } };
    const merged = mergeDocuments(
      [generated, dhcp()],
      [{ machine: { kubelet: {} }, cluster: { a: 1 } }],
    );
    assert.deepEqual(merged, [
      {
        version: "v1alpha1",
        machine: { type: "worker", kubelet: {} },
        cluster: { a: 1 },
      },
      dhcp(),
    ]);
  });

  test("keeps the order of the first list, then appends", () => {
    const merged = mergeDocuments(
      [dhcp({ name: "a" }), dhcp({ name: "b" })],
      [dhcp({ name: "c" }), dhcp({ name: "a", x: 1 })],
    );
    assert.deepEqual(
      merged.map((d) => d.name),
      ["a", "b", "c"],
    );
  });
});
