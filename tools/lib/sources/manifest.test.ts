import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { manifest, parseManifests } from "./manifest.ts";

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("parseManifests", () => {
  test("reads every document, skipping empty ones", () => {
    const objects = parseManifests(
      "---\n# nothing\n---\na: 1\n---\nb: 2\n",
      "test",
    );
    assert.deepEqual(objects, [{ a: 1 }, { b: 2 }]);
  });

  test("flattens lists", () => {
    const objects = parseManifests(
      "kind: List\nitems:\n  - kind: A\n  - kind: B\n",
      "test",
    );
    assert.deepEqual(
      objects.map((o) => o.kind),
      ["A", "B"],
    );
  });

  // helm writes file modes like 0400, and kubernetes reads them as octal (256)
  test("reads a leading zero as octal, as kubernetes does", () => {
    const [object] = parseManifests(
      "a: 0400\nb: 10\nc: '0400'\nd: 0.5\ne: 08\n",
      "test",
    );
    assert.equal(object.a, 256);
    assert.equal(object.b, 10);
    assert.equal(object.c, "0400");
    assert.equal(object.d, 0.5);
    assert.equal(object.e, 8);
  });

  test("resolves merge keys", () => {
    const [object] = parseManifests(
      "base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\n",
      "test",
    );
    assert.deepEqual(object.use, { x: 1, y: 2 });
  });

  test("names where invalid yaml came from", () => {
    assert.throws(
      () => parseManifests("a: [", "somewhere.yaml"),
      /somewhere\.yaml/,
    );
  });
});

describe("manifest", () => {
  test("reads a path relative to the app's directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    dirs.push(dir);
    writeFileSync(join(dir, "m.yaml"), "kind: A\n---\nkind: B\n");
    assert.deepEqual(
      (await manifest("m.yaml", dir)).map((o) => o.kind),
      ["A", "B"],
    );
  });

  test("a missing file is an error", async () => {
    await assert.rejects(
      () => manifest("missing.yaml", "/nonexistent"),
      /missing\.yaml/,
    );
  });
});
