import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { cacheDir } from "../cache.ts";
import { parseManifests, writeAtomic } from "./manifest.ts";

const run = promisify(execFile);

type Obj = Record<string, any>;

// the objects of an upstream kustomize overlay (e.g. `github.com/org/repo/config/default?ref=v1`),
// for projects that publish their install manifests only that way. kustomize is used for nothing else.
export const kustomize = async (url: string): Promise<Obj[]> => {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const path = cacheDir("kustomize", `${key}.yaml`);
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    try {
      ({ stdout: text } = await run(
        process.env.KUSTOMIZE ?? "kustomize",
        ["build", url],
        {
          maxBuffer: 1024 * 1024 * 1024,
        },
      ));
    } catch (e: any) {
      throw new Error(
        `kustomize build ${url}: ${String(e.stderr || e.message).trim()}`,
      );
    }
    writeAtomic(path, text);
  }
  return parseManifests(text, url);
};
