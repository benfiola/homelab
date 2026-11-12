import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseAllDocuments } from "yaml";
import { cacheDir, cacheKey, cachedText } from "./cache.ts";

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

// the objects in a manifest at a url (downloaded once, then cached) or at a path inside the app
export const manifest = async (
  source: string,
  appDir: string,
): Promise<Obj[]> => {
  if (!/^https?:\/\//.test(source)) {
    const path = resolve(appDir, source);
    return parseManifests(readFileSync(path, "utf-8"), path);
  }
  const path = cacheDir(
    "manifests",
    `${cacheKey(source)}-${basename(new URL(source).pathname)}`,
  );
  return parseManifests(await cachedText(path, () => download(source)), source);
};

// the text at a url (downloaded once, then cached): the url should be immutable, as a pinned commit or tag is
export const remoteText = (url: string): Promise<string> =>
  cachedText(
    cacheDir("files", `${cacheKey(url)}-${basename(new URL(url).pathname)}`),
    () => download(url),
  );
