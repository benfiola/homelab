import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

// download cache (gitignored): deleting it refetches everything
export const cacheDir = (...parts: string[]) =>
  join(
    process.env.HOMELAB_CACHE ??
      resolve(import.meta.dirname, "../../../.cache"),
    ...parts,
  );

// a short name for what was fetched with these inputs
export const cacheKey = (...inputs: (string | Buffer)[]) => {
  const hash = createHash("sha256");
  inputs.forEach((input) => hash.update(input));
  return hash.digest("hex").slice(0, 16);
};

// both are written to a temporary place first, so that a concurrent build never sees half of
// one, and loses the race harmlessly.

// the text at `path`, made by `produce` if it isn't there yet
export const cachedText = async (
  path: string,
  produce: () => Promise<string>,
): Promise<string> => {
  try {
    return readFileSync(path, "utf-8");
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      throw e;
    }
  }
  const text = await produce();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(temp, text);
  renameSync(temp, path);
  return text;
};

// the directory at `dest`, made if it isn't there yet: `populate` is given a directory to work
// in, and returns the one inside it that becomes `dest`
export const cachedDir = async (
  dest: string,
  populate: (work: string) => Promise<string>,
): Promise<string> => {
  if (existsSync(dest)) {
    return dest;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const work = mkdtempSync(join(dirname(dest), ".work-"));
  try {
    renameSync(await populate(work), dest);
  } catch (e) {
    if (!existsSync(dest)) {
      throw e;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return dest;
};
