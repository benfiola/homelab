import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { cacheDir } from "../cache.ts";

const run = promisify(execFile);

const files = ["jsonnetfile.json", "jsonnetfile.lock.json"];

// installs the libraries an app's jsonnetfile.json asks for, at the versions its lock file
// records, and returns where they are. a library set is cached under a hash of both files, so
// changing either one installs again and nothing ever needs invalidating.
const libraries = async (appDir: string): Promise<string | undefined> => {
  const [spec, lock] = files.map((name) => join(appDir, name));
  if (!existsSync(spec)) {
    return undefined;
  }
  if (!existsSync(lock)) {
    throw new Error(
      `${appDir} has a jsonnetfile.json but no jsonnetfile.lock.json (run 'jb install' there)`,
    );
  }
  const hash = createHash("sha256");
  for (const file of [spec, lock]) {
    hash.update(readFileSync(file));
  }
  const dest = cacheDir("jsonnet", hash.digest("hex").slice(0, 16));
  if (!existsSync(dest)) {
    mkdirSync(dirname(dest), { recursive: true });
    const temp = mkdtempSync(join(dirname(dest), ".install-"));
    try {
      for (const file of [spec, lock]) {
        copyFileSync(file, join(temp, basename(file)));
      }
      await run("jb", ["install"], { cwd: temp });
      try {
        renameSync(temp, dest);
      } catch (e: any) {
        // a concurrent build installed the same libraries first, which is fine
        if (!existsSync(dest)) {
          throw e;
        }
      }
    } catch (e: any) {
      throw new Error(
        `jb install (${appDir}): ${String(e.stderr || e.message).trim()}`,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  return join(dest, "vendor");
};

// evaluates a jsonnet file of the app, with the libraries of its jsonnetfile.json
export const jsonnet = async (file: string, appDir: string): Promise<any> => {
  const path = resolve(appDir, file);
  const vendor = await libraries(appDir);
  try {
    const { stdout } = await run(
      "jsonnet",
      [...(vendor ? ["--jpath", vendor] : []), path],
      {
        maxBuffer: 1024 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  } catch (e: any) {
    throw new Error(`jsonnet ${path}: ${String(e.stderr || e.message).trim()}`);
  }
};
