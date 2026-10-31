import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { cacheDir } from "../cache.ts";

type Obj = Record<string, any>;

// kubernetes reads yaml as 1.1, where 0400 is octal (256): helm writes file modes that way. the
// yaml library follows 1.2 and would read 400, which is a different mode.
const legacyOctal = {
  identify: (value: unknown) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^0[0-7]+$/,
  resolve: (str: string) => parseInt(str, 8),
};

// the objects in a (multi-document) yaml string; `List` kinds are flattened
export const parseManifests = (text: string, origin: string): Obj[] => {
  const objects: Obj[] = [];
  for (const doc of parseAllDocuments(text, {
    merge: true,
    customTags: (tags) => [legacyOctal, ...tags],
  })) {
    if (doc.errors.length > 0) {
      throw new Error(`${origin}: ${doc.errors[0].message}`);
    }
    const obj = doc.toJSON();
    if (!obj) {
      continue;
    }
    if (
      typeof obj.kind === "string" &&
      obj.kind.endsWith("List") &&
      Array.isArray(obj.items)
    ) {
      objects.push(...obj.items);
    } else {
      objects.push(obj);
    }
  }
  return objects;
};

// limits concurrent downloads
const limit = 8;
let active = 0;
const waiting: (() => void)[] = [];

const download = async (url: string): Promise<string> => {
  if (active >= limit) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return await response.text();
      } catch (e: any) {
        if (attempt === 3) {
          throw new Error(`${url}: ${e.message}`);
        }
      }
    }
  } finally {
    active--;
    waiting.shift()?.();
  }
};

// writes through a temporary file, so a concurrent build never reads half a download
export const writeAtomic = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(temp, content);
  renameSync(temp, path);
};

// the objects in a manifest at a url (downloaded once, then cached) or at a path inside the app
export const manifest = async (
  source: string,
  appDir: string,
): Promise<Obj[]> => {
  if (!/^https?:\/\//.test(source)) {
    const path = resolve(appDir, source);
    return parseManifests(readFileSync(path, "utf-8"), path);
  }
  const key = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const path = cacheDir(
    "manifests",
    `${key}-${basename(new URL(source).pathname)}`,
  );
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    text = await download(source);
    writeAtomic(path, text);
  }
  return parseManifests(text, source);
};
