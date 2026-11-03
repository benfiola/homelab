import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { jsonnet } from "./jsonnet.ts";
import { hasCommand } from "../testing.ts";

const hasJsonnet = hasCommand("jsonnet");

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const app = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "jsonnet-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

describe("jsonnet", { skip: !hasJsonnet && "jsonnet is not installed" }, () => {
  test("evaluates a file in the app's directory to its json", async () => {
    const dir = app({ "main.jsonnet": "{ a: 1 + 1, b: [std.length('abc')] }" });
    assert.deepEqual(await jsonnet("main.jsonnet", dir), { a: 2, b: [3] });
  });

  test("files can import each other", async () => {
    const dir = app({
      "lib.libsonnet": "{ name: 'x' }",
      "main.jsonnet": "local lib = import 'lib.libsonnet'; { name: lib.name }",
    });
    assert.deepEqual(await jsonnet("main.jsonnet", dir), { name: "x" });
  });

  test("a jsonnet error names the file and says what is wrong", async () => {
    const dir = app({ "main.jsonnet": "{ a: error 'nope' }" });
    await assert.rejects(
      () => jsonnet("main.jsonnet", dir),
      /main\.jsonnet[\s\S]*nope/,
    );
  });

  test("a jsonnetfile.json needs its lock file, which pins the libraries", async () => {
    const dir = app({
      "main.jsonnet": "{}",
      "jsonnetfile.json": '{"version": 1, "dependencies": []}',
    });
    await assert.rejects(
      () => jsonnet("main.jsonnet", dir),
      /no jsonnetfile\.lock\.json/,
    );
  });
});
