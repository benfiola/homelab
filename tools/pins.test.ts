import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";
import { findHash, refresh, substitute, toSri, type Pin } from "./pins.ts";

const sha = (char: string) => char.repeat(64);

describe("substitute", () => {
  test("fills in each variable, wherever it is", () => {
    assert.equal(
      substitute("a/${version}/b-${arch}-${version}", {
        version: "1.2",
        arch: "x86",
      }),
      "a/1.2/b-x86-1.2",
    );
  });

  test("an unknown variable is an error, not an empty string", () => {
    assert.throws(
      () => substitute("a-${nope}", { version: "1" }),
      /unknown variable 'nope' in 'a-\$\{nope\}'/,
    );
  });
});

describe("toSri", () => {
  test("is the base64 of the hash, as nix reads it", () => {
    // the sha256 of nothing
    assert.equal(
      toSri("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });
});

describe("findHash", () => {
  test("takes a bare hash, lower-cased", () => {
    assert.equal(findHash(`${sha("A")}\n`, "any.tar.gz"), sha("a"));
  });

  test("takes the line of the asset from a list, and no other", () => {
    const text = `${sha("1")}  other.tar.gz\n${sha("2")}  tool.tar.gz\n${sha("3")}  tool.tar.gz.sig\n`;
    assert.equal(findHash(text, "tool.tar.gz"), sha("2"));
  });

  test("reads binary-mode and path-qualified names", () => {
    assert.equal(
      findHash(`${sha("4")} *./dist/tool.zip\n`, "tool.zip"),
      sha("4"),
    );
  });

  test("an asset that isn't listed is an error", () => {
    assert.throws(
      () => findHash(`${sha("1")}  other.tar.gz\n`, "tool.tar.gz"),
      /no checksum for 'tool.tar.gz'/,
    );
  });

  test("a hash that is not 64 hex digits is not one", () => {
    assert.throws(() => findHash(`${"1".repeat(63)}  tool\n`, "tool"));
    assert.throws(() => findHash(`${"g".repeat(64)}  tool\n`, "tool"));
  });
});

describe("refresh", () => {
  const pin = (
    hashes: Record<string, string>,
    extra: Partial<Pin> = {},
  ): Pin => ({
    version: "2.0.0",
    url: "https://example.test/v${version}/tool-${arch}.tar.gz",
    checksum: "${url}.sha256",
    unpack: "tar",
    hashes,
    ...extra,
  });

  const fetches = (checksums: Record<string, string>) => {
    const asked: string[] = [];
    return {
      asked,
      get: async (url: string) => {
        asked.push(url);
        if (!(url in checksums)) throw new Error(`unexpected request: ${url}`);
        return checksums[url];
      },
    };
  };

  test("changes only the hashes that differ, and counts them", async () => {
    const current = toSri(sha("a"));
    const pins = { tool: pin({ amd64: current, arm64: toSri(sha("0")) }) };
    const { get } = fetches({
      "https://example.test/v2.0.0/tool-amd64.tar.gz.sha256": sha("a"),
      "https://example.test/v2.0.0/tool-arm64.tar.gz.sha256": sha("b"),
    });
    assert.equal(await refresh(pins, get), 1);
    assert.equal(pins.tool.hashes.amd64, current);
    assert.equal(pins.tool.hashes.arm64, toSri(sha("b")));
  });

  test("nothing is changed when the hashes are current", async () => {
    const pins = {
      tool: pin({ amd64: toSri(sha("a")), arm64: toSri(sha("b")) }),
    };
    const { get } = fetches({
      "https://example.test/v2.0.0/tool-amd64.tar.gz.sha256": sha("a"),
      "https://example.test/v2.0.0/tool-arm64.tar.gz.sha256": sha("b"),
    });
    assert.equal(await refresh(pins, get), 0);
  });

  test("names an arch as upstream does, but keys its hash by amd64 and arm64", async () => {
    const pins = {
      tool: pin(
        { amd64: "", arm64: "" },
        {
          arches: { amd64: "x86_64", arm64: "aarch64" },
          checksum: "https://example.test/sums-${version}.txt",
        },
      ),
    };
    const { asked, get } = fetches({
      "https://example.test/sums-2.0.0.txt": `${sha("c")}  tool-x86_64.tar.gz\n${sha("d")}  tool-aarch64.tar.gz\n`,
    });
    assert.equal(await refresh(pins, get), 2);
    assert.equal(pins.tool.hashes.amd64, toSri(sha("c")));
    assert.equal(pins.tool.hashes.arm64, toSri(sha("d")));
    assert.equal(asked.length, 2);
  });

  test("a version change is what is looked up", async () => {
    const pins = { tool: pin({ amd64: "", arm64: "" }) };
    pins.tool.version = "3.1.4";
    const { asked, get } = fetches({
      "https://example.test/v3.1.4/tool-amd64.tar.gz.sha256": sha("a"),
      "https://example.test/v3.1.4/tool-arm64.tar.gz.sha256": sha("b"),
    });
    await refresh(pins, get);
    assert.deepEqual(asked, [
      "https://example.test/v3.1.4/tool-amd64.tar.gz.sha256",
      "https://example.test/v3.1.4/tool-arm64.tar.gz.sha256",
    ]);
  });
});

test("a tool that isn't pinned is an error that lists those that are", async () => {
  const result = await promisify(execFile)("node", [
    join(import.meta.dirname, "pins.ts"),
    "set",
    "nope",
    "1.0.0",
  ]).then(
    () => ({ code: 0, stderr: "" }),
    (e) => ({ code: e.code as number, stderr: e.stderr as string }),
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no tool 'nope' \(have: \w[\w, -]*\)/);
});
