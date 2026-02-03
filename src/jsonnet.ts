import { rm, writeFile } from "fs/promises";
import path from "path";
import { cwd } from "process";
import * as shlex from "shlex";
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

  const commands = [`jb init`];
  for (const bundle of bundles) {
    const command = ["jb", "install"];
    if (opts.vendorDir) {
      command.push(`--jsonnetpkg-home=${opts.vendorDir}`);
    }
    command.push(bundle);

    commands.push(shlex.join(command));
  }

  for (const command of commands) {
    const cmd = ["sh", "-c", `cd ${dir} && ${command}`];
    await exec(cmd);
  }

  const files = [
    path.join(dir, "jsonnetfile.json"),
    path.join(dir, "jsonnetfile.lock.json"),
  ];
  for (const file of files) {
    await rm(file);
  }
};
