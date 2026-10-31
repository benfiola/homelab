import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contains, isAddress, subnet } from "./ip.ts";

describe("subnet", () => {
  test("knows its network, size and addresses", () => {
    const s = subnet("192.168.8.0/24");
    assert.equal(s.network, "192.168.8.0");
    assert.equal(s.prefix, 24);
    assert.equal(s.host(1), "192.168.8.1");
    assert.equal(s.base, "192.168.8");
  });

  test("an address past the first /24 of a larger network is still within it", () => {
    const s = subnet("192.168.32.0/23");
    assert.equal(s.host(2), "192.168.32.2");
    assert.equal(s.host(258), "192.168.33.2");
    assert.equal(s.base, "192.168.32");
  });

  test("refuses what is not a network", () => {
    assert.throws(() => subnet("192.168.8.1/24"), /host bits set/);
    assert.throws(() => subnet("192.168.8.0"), /not a subnet/);
    assert.throws(() => subnet("192.168.8.0/31"), /not a subnet/);
    assert.throws(() => subnet("192.168.256.0/24"), /not a subnet/);
    assert.throws(() => subnet("nope/24"), /not a subnet/);
    assert.throws(() => subnet("10.0.0.0/7"), /not a subnet/);
  });

  test("is as large as a /8 and as small as a /30", () => {
    assert.equal(subnet("10.0.0.0/8").prefix, 8);
    assert.equal(subnet("10.0.0.4/30").host(1), "10.0.0.5");
  });
});

describe("contains", () => {
  test("is true for an address within the network", () => {
    assert.equal(contains("192.168.88.0/24", "192.168.88.1"), true);
    assert.equal(contains("192.168.32.0/23", "192.168.33.200"), true);
    assert.equal(contains("192.168.88.1/32", "192.168.88.1"), true);
    assert.equal(contains("192.168.88.1", "192.168.88.1"), true);
  });

  test("is false outside it, and for what is not an address", () => {
    assert.equal(contains("192.168.88.0/24", "192.168.89.1"), false);
    assert.equal(contains("192.168.88.1/32", "192.168.88.2"), false);
    assert.equal(contains("192.168.88.0/24", "nope"), false);
  });

  test("a prefix is from 0 to 32", () => {
    assert.equal(contains("0.0.0.0/0", "192.168.88.1"), true);
    assert.equal(contains("192.168.88.1/33", "192.168.88.1"), false);
    assert.equal(contains("192.168.88.1/-1", "192.168.88.1"), false);
  });
});

test("isAddress", () => {
  assert.equal(isAddress("10.0.0.1"), true);
  assert.equal(isAddress("10.0.0"), false);
  assert.equal(isAddress("10.0.0.256"), false);
  assert.equal(isAddress("a.b.c.d"), false);
});
