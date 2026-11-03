import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonical, compact } from "./object.ts";

describe("compact", () => {
  test("removes undefined values at any depth, including in lists", () => {
    assert.deepEqual(
      compact({
        a: undefined,
        b: { c: undefined, d: 1 },
        e: [{ f: undefined }],
      }),
      { b: { d: 1 }, e: [{}] },
    );
  });

  test("keeps everything else, including empty values and falsy ones", () => {
    const value = { a: {}, b: [], c: 0, d: "", e: false, f: null };
    assert.deepEqual(compact(value), value);
  });
});

describe("canonical", () => {
  test("is the same for objects that differ only in key order, at any depth", () => {
    assert.equal(
      canonical({ a: 1, b: { c: 2, d: [{ e: 1, f: 2 }] } }),
      canonical({ b: { d: [{ f: 2, e: 1 }], c: 2 }, a: 1 }),
    );
  });

  test("differs for objects that differ in content, and in list order", () => {
    assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
    assert.notEqual(canonical([1, 2]), canonical([2, 1]));
  });
});
