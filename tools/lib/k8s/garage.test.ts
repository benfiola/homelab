import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { garageBucket, garageKey } from "./garage.ts";

describe("garageBucket", () => {
  const [owner, writer, reader] = ["owner", "writer", "reader"].map((n) =>
    garageKey(n),
  );

  test("owners own it, and read and write", () => {
    const b = garageBucket("data", [owner]);
    assert.deepEqual(b.spec.keyPermissions, [
      { keyRef: owner.name, owner: true, read: true, write: true },
    ]);
  });

  test("read-write keys read and write, but do not own it", () => {
    const b = garageBucket("data", [], { rwKeys: [writer] });
    assert.deepEqual(b.spec.keyPermissions, [
      { keyRef: writer.name, owner: false, read: true, write: true },
    ]);
  });

  test("read-only keys only read", () => {
    const b = garageBucket("data", [], { roKeys: [reader] });
    assert.deepEqual(b.spec.keyPermissions, [
      { keyRef: reader.name, owner: false, read: true, write: false },
    ]);
  });

  test("all three together, in that order", () => {
    const b = garageBucket("data", [owner], {
      rwKeys: [writer],
      roKeys: [reader],
    });
    assert.deepEqual(
      b.spec.keyPermissions.map((p: any) => p.keyRef),
      [owner.name, writer.name, reader.name],
    );
  });
});
