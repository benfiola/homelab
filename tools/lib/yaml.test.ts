import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { z } from "./schema.ts";
import { parseDocuments, readYaml, toYaml } from "./yaml.ts";

const dir = mkdtempSync(join(tmpdir(), "yaml-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("readYaml", () => {
  const schema = z.strictObject({ name: z.string() });

  test("is the file, as the schema reads it", () => {
    const file = join(dir, "ok.yaml");
    writeFileSync(file, "name: a\n");
    assert.deepEqual(readYaml(file, schema), { name: "a" });
  });

  test("names the file and the place of what is wrong", () => {
    const file = join(dir, "bad.yaml");
    writeFileSync(file, "name: 1\n");
    assert.throws(() => readYaml(file, schema), new RegExp(`${file}\\.name: `));
  });
});

describe("parseDocuments", () => {
  test("skips empty documents", () => {
    assert.deepEqual(parseDocuments("---\na: 1\n---\n---\nb: 2\n"), [
      { a: 1 },
      { b: 2 },
    ]);
  });
});

describe("toYaml", () => {
  test("separates documents, without wrapping long lines or aliasing repeats", () => {
    const shared = { x: "a very long line ".repeat(10).trim() };
    const text = toYaml([{ a: shared, b: shared }, { c: 1 }]);
    assert.ok(!text.includes("&a"));
    assert.ok(!text.includes("*a"));
    assert.deepEqual(parseDocuments(text), [
      { a: shared, b: shared },
      { c: 1 },
    ]);
    assert.equal(text.split("---\n").length, 2);
  });
});
