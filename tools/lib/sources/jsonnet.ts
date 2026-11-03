import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { capture } from "../exec.ts";
import { cacheDir, cacheKey, cachedDir } from "./cache.ts";

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
  const dest = await cachedDir(
    cacheDir("jsonnet", cacheKey(readFileSync(spec), readFileSync(lock))),
    async (work) => {
      for (const file of [spec, lock]) {
        copyFileSync(file, join(work, basename(file)));
      }
      await capture("jb", ["install"], {
        cwd: work,
        context: `jb install (${appDir})`,
      });
      return work;
    },
  );
  return join(dest, "vendor");
};

// evaluates a jsonnet file of the app, with the libraries of its jsonnetfile.json
export const jsonnet = async (file: string, appDir: string): Promise<any> => {
  const path = resolve(appDir, file);
  const vendor = await libraries(appDir);
  const output = await capture(
    "jsonnet",
    [...(vendor ? ["--jpath", vendor] : []), path],
    { context: `jsonnet ${path}` },
  );
  return JSON.parse(output);
};
