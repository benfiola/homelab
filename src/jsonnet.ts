import { rm, writeFile } from "fs/promises";
import path from "path";
import { cwd } from "process";
import { exec } from "./exec";
import { getTempy } from "./tempy";

interface EvaluateOpts {
  jsonnetFile?: string;
  jsonnet?: string;
  libs?: string[];
}

export const evaluate = async (opts: EvaluateOpts = {}) => {
  const tempy = await getTempy();
  return await tempy.temporaryDirectoryTask(async (dir) => {
    let jsonnetFile: string | undefined;
    if (opts.jsonnet && opts.jsonnetFile) {
      throw new Error(`only one of jsonnet, jsonnetFile can be defined`);
    } else if (opts.jsonnet) {
      jsonnetFile = path.join(dir, "main.jsonnet");
      await writeFile(jsonnetFile, opts.jsonnet);
    } else if (opts.jsonnetFile) {
      jsonnetFile = opts.jsonnetFile;
    }
    if (!jsonnetFile) {
      throw new Error(`jsonnetfile is unset`);
    }

    const command = ["jsonnet"];
    const libs = opts.libs ?? [];
    for (const lib of libs) {
      command.push("--jpath", lib);
    }
    command.push(jsonnetFile);

    return await exec(command);
  });
};

interface InstallOpts {
  dir?: string;
  vendorDir?: string;
}

export const install = async (opts: InstallOpts, ...bundles: string[]) => {
  const dir = opts.dir ?? cwd();

  await exec(["jb", "init"], { cwd: dir });

  for (const bundle of bundles) {
    const command = ["jb", "install"];
    if (opts.vendorDir) {
      command.push(`--jsonnetpkg-home=${opts.vendorDir}`);
    }
    command.push(bundle);
    await exec(command, { cwd: dir });
  }

  for (const file of ["jsonnetfile.json", "jsonnetfile.lock.json"]) {
    await rm(path.join(dir, file));
  }
};
