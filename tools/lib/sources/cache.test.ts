import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { cacheKey, cachedDir, cachedText } from "./cache.ts";

const root = mkdtempSync(join(tmpdir(), "cache-"));
after(() => rmSync(root, { recursive: true, force: true }));

describe("cacheKey", () => {
  test("depends on every input", () => {
    assert.equal(cacheKey("a", "b"), cacheKey("a", "b"));
    assert.notEqual(cacheKey("a", "b"), cacheKey("a", "c"));
    assert.equal(cacheKey("a").length, 16);
  });
});

describe("cachedText", () => {
  test("is made once, and read after", async () => {
    const path = join(root, "text", "a.txt");
    let made = 0;
    const produce = async () => `made ${++made}`;
    assert.equal(await cachedText(path, produce), "made 1");
    assert.equal(await cachedText(path, produce), "made 1");
    assert.equal(readFileSync(path, "utf-8"), "made 1");
  });

  test("is not kept when it fails", async () => {
    const path = join(root, "text", "b.txt");
    await assert.rejects(
      () => cachedText(path, () => Promise.reject(new Error("failed"))),
      /failed/,
    );
    assert.ok(!existsSync(path));
  });
});

describe("cachedDir", () => {
  const populate = (content: string) => async (work: string) => {
    mkdirSync(join(work, "inner"));
    writeFileSync(join(work, "inner", "f"), content);
    return join(work, "inner");
  };

  test("is the directory populate returns, made once", async () => {
    const dest = join(root, "dir", "a");
    assert.equal(await cachedDir(dest, populate("one")), dest);
    assert.equal(await cachedDir(dest, populate("two")), dest);
    assert.equal(readFileSync(join(dest, "f"), "utf-8"), "one");
  });

  test("leaves nothing behind, whether it works or not", async () => {
    const parent = join(root, "dir", "b");
    await cachedDir(join(parent, "ok"), populate("x"));
    await assert.rejects(
      () =>
        cachedDir(join(parent, "bad"), () =>
          Promise.reject(new Error("failed")),
        ),
      /failed/,
    );
    assert.ok(!existsSync(join(parent, "bad")));
    assert.deepEqual(readdirSync(parent), ["ok"]);
  });
});
