import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { helmImage } from "./images.ts";

describe("helmImage", () => {
  test("splits an image into a repository and a tag", () => {
    assert.deepEqual(helmImage("ghcr.io/org/name:v1.2.3"), {
      repository: "ghcr.io/org/name",
      tag: "v1.2.3",
    });
  });

  test("keeps a registry port in the repository", () => {
    assert.deepEqual(helmImage("localhost:5000/name:1"), {
      repository: "localhost:5000/name",
      tag: "1",
    });
  });

  test("refuses an image without a tag, or pinned by digest", () => {
    assert.throws(() => helmImage("ghcr.io/org/name"), /expected/);
    assert.throws(() => helmImage("localhost:5000/name"), /expected/);
    assert.throws(() => helmImage("org/name:1@sha256:abc"), /expected/);
  });
});
