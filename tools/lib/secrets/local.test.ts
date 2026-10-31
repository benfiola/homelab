import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  checkPrivate,
  homelabDir,
  readSecret,
  secretPath,
  secretsFile,
  writePrivate,
} from "./local.ts";

let dir: string;
let previous: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "homelab-"));
  previous = process.env.HOMELAB_DIR;
  process.env.HOMELAB_DIR = join(dir, ".homelab");
});
afterEach(() => {
  if (previous === undefined) delete process.env.HOMELAB_DIR;
  else process.env.HOMELAB_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

const mode = (file: string) => statSync(file).mode & 0o777;

describe("checkPrivate", () => {
  test("accepts a file only its owner can read", () => {
    const file = join(dir, "a");
    writeFileSync(file, "x", { mode: 0o600 });
    assert.equal(checkPrivate(file), file);
    chmodSync(file, 0o400);
    assert.equal(checkPrivate(file), file);
  });

  test("refuses a file others can read, and says how to fix it", () => {
    const file = join(dir, "a");
    for (const m of [0o640, 0o604, 0o644, 0o660, 0o666]) {
      writeFileSync(file, "x");
      chmodSync(file, m);
      assert.throws(
        () => checkPrivate(file),
        new RegExp(`has mode ${m.toString(8)}: .*chmod 600 ${file}`),
      );
    }
  });
});

describe("writePrivate", () => {
  test("makes the directory for its owner alone, and the file too", () => {
    const file = secretPath("talos");
    writePrivate(file, "bundle");
    assert.equal(mode(homelabDir()), 0o700);
    assert.equal(mode(file), 0o600);
    assert.equal(readSecret(file), "bundle");
  });

  test("tightens a file that already existed", () => {
    const file = secretPath("talos");
    writePrivate(file, "one");
    chmodSync(file, 0o644);
    writePrivate(file, "two");
    assert.equal(mode(file), 0o600);
    assert.equal(readSecret(file), "two");
  });
});

describe("secretsFile", () => {
  test("is the file given, if it is private", () => {
    const file = join(dir, "given.yaml");
    writeFileSync(file, "x", { mode: 0o600 });
    assert.equal(secretsFile(file, "talos"), file);
    chmodSync(file, 0o644);
    assert.throws(
      () => secretsFile(file, "talos"),
      /must be readable by its owner only/,
    );
  });

  test("a file that was given and isn't there is an error", () => {
    assert.throws(
      () => secretsFile(join(dir, "nope"), "talos"),
      /no such secrets file/,
    );
  });

  test("is the one this machine holds, when none is given", () => {
    assert.equal(secretsFile(undefined, "talos"), undefined);
    writePrivate(secretPath("talos"), "x");
    assert.equal(secretsFile(undefined, "talos"), secretPath("talos"));
  });

  test("refuses the one this machine holds if it is not private", () => {
    writePrivate(secretPath("talos"), "x");
    chmodSync(secretPath("talos"), 0o644);
    assert.throws(
      () => secretsFile(undefined, "talos"),
      /must be readable by its owner only/,
    );
  });
});
