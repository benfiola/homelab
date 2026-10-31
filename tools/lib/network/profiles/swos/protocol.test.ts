import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  encode,
  fromMask,
  hasBit,
  hexDecode,
  hexEncode,
  parse,
  toMask,
  withBit,
} from "./protocol.ts";

describe("parse", () => {
  test("reads swos's object literals", () => {
    assert.deepEqual(
      parse("{en:0x01ff,nm:['506f727431',''],vlan:[0x02,0x00],prt:0x12}"),
      { en: 511, nm: ["506f727431", ""], vlan: [2, 0], prt: 18 },
    );
  });

  test("reads tables, and keys that start with a bang", () => {
    assert.deepEqual(parse("[{vid:0x08,mbr:0x01},{vid:0x20,mbr:0x02}]"), [
      { vid: 8, mbr: 1 },
      { vid: 32, mbr: 2 },
    ]);
    assert.deepEqual(parse("{!x:0x01}"), { "!x": 1 });
  });
});

describe("encode", () => {
  test("numbers are whole bytes of hex, strings are hex in quotes", () => {
    assert.equal(
      encode({ en: 511, nm: ["Port1", ""], vlan: [0, 3], id: "core" }),
      "{en:0x01ff,nm:['506f727431',''],vlan:[0x00,0x03],id:'636f7265'}",
    );
  });

  test("a table is an array of objects", () => {
    assert.equal(
      encode([
        { vid: 8, nm: "x" },
        { vid: 4094, nm: "" },
      ]),
      "[{vid:0x08,nm:'78'},{vid:0x0ffe,nm:''}]",
    );
  });

  test("round-trips through parse", () => {
    const data = { en: 0x3ffff, nm: [hexEncode("a b"), hexEncode("é")] };
    const wire = encode({ en: data.en, nm: ["a b", "é"] });
    assert.deepEqual(parse(wire), data);
    assert.equal(hexDecode(hexEncode("é")), "é");
  });

  test("refuses what it cannot encode", () => {
    assert.throws(() => encode({ a: true }), /cannot encode a boolean/);
  });
});

describe("port masks", () => {
  test("port 1 is bit 0", () => {
    assert.equal(toMask([1, 3, 18]), 0x020005);
    assert.deepEqual(fromMask(0x020005, 18), [1, 3, 18]);
  });

  test("the top bit stays positive", () => {
    const mask = toMask([32]);
    assert.equal(mask, 0x80000000);
    assert.equal(hasBit(mask, 31), true);
    assert.equal(withBit(mask, 31, false), 0);
    assert.equal(withBit(0, 31, true), 0x80000000);
  });

  test("withBit sets and clears one port", () => {
    assert.equal(withBit(0b101, 1, true), 0b111);
    assert.equal(withBit(0b111, 0, false), 0b110);
    assert.equal(withBit(0b111, 0, true), 0b111);
  });
});
