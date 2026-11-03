import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, test } from "node:test";
import { capture, run, withTempFile } from "./exec.ts";

describe("capture", () => {
  test("is what the program prints", async () => {
    assert.equal(await capture("echo", ["hello"]), "hello\n");
  });

  test("fails with the context and the program's stderr", async () => {
    await assert.rejects(
      () =>
        capture("sh", ["-c", "echo nope >&2; exit 1"], { context: "doing it" }),
      new Error("doing it: nope"),
    );
  });

  test("says when the program is not installed", async () => {
    await assert.rejects(
      () => capture("no-such-program", []),
      /no-such-program is not installed/,
    );
  });
});

describe("run", () => {
  test("gives the program its input", async () => {
    await run("sh", ["-c", 'test "$(cat)" = hi'], { input: "hi" });
  });

  test("fails when the program does", async () => {
    await assert.rejects(() => run("sh", ["-c", "exit 3"]), /sh exited with 3/);
  });
});

describe("withTempFile", () => {
  test("is a private file while it is used, and gone after", async () => {
    let path = "";
    await withTempFile("a.txt", "content", async (file) => {
      path = file;
      assert.equal(readFileSync(file, "utf-8"), "content");
      assert.equal(statSync(file).mode & 0o777, 0o600);
    });
    assert.ok(!existsSync(path));
  });

  test("is gone after a failure too", async () => {
    let path = "";
    await assert.rejects(
      () =>
        withTempFile("a.txt", "x", async (file) => {
          path = file;
          throw new Error("failed");
        }),
      /failed/,
    );
    assert.ok(!existsSync(path));
  });
});
