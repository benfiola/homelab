import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { align } from "./cli.ts";

describe("align", () => {
  test("pads each column to its widest cell, two spaces apart", () => {
    assert.deepEqual(
      align([
        ["router.rsc", "routeros"],
        ["office.ap.sh", "openwrt"],
        ["a", "b"],
      ]),
      ["router.rsc    routeros", "office.ap.sh  openwrt", "a             b"],
    );
  });

  test("leaves no trailing spaces, including after an empty last cell", () => {
    assert.deepEqual(
      align([
        ["ok", "alloy", ""],
        ["ok", "cilium", "2 accepted"],
      ]),
      ["ok  alloy", "ok  cilium  2 accepted"],
    );
  });

  test("copes with rows of different lengths, and with none", () => {
    assert.deepEqual(align([["a"], ["b", "c"]]), ["a", "b  c"]);
    assert.deepEqual(align([]), []);
  });
});
