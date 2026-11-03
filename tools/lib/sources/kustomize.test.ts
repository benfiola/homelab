import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { hasCommand, serve } from "../testing.ts";
import { kustomize } from "./kustomize.ts";

const cache = mkdtempSync(join(tmpdir(), "kustomize-"));
process.env.HOMELAB_CACHE = cache;

describe(
  "kustomize",
  { skip: !hasCommand("kustomize") && "kustomize is not installed" },
  () => {
    let server: Awaited<ReturnType<typeof serve>>;
    before(async () => {
      server = await serve({
        "config.yaml":
          "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\n  namespace: old\n",
      });
    });
    after(() => {
      server.close();
      rmSync(cache, { recursive: true, force: true });
    });

    test("is the objects of a manifest at a url", async () => {
      const [config] = await kustomize(server.url("config.yaml"));
      assert.equal(config.metadata.name, "c");
      assert.equal(config.metadata.namespace, "old");
    });

    test("can move them to a namespace, and label them", async () => {
      const [config] = await kustomize(server.url("config.yaml"), {
        namespace: "new",
        labels: { a: "b" },
      });
      assert.equal(config.metadata.namespace, "new");
      assert.equal(config.metadata.labels.a, "b");
    });

    test("names what failed", async () => {
      await assert.rejects(
        () => kustomize(server.url("missing.yaml")),
        /kustomize build http:\/\/127\.0\.0\.1:\d+\/missing\.yaml/,
      );
    });
  },
);
