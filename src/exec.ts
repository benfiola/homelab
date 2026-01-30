import { spawn as baseSpawn, ChildProcess } from "child_process";
import treeKill from "tree-kill";
import { logger } from "./logger";

export interface SpawnOpts {
  env?: Record<string, string>;
  output?: "pipe" | "inherit";
}

export const spawn = (cmd: string[], opts: SpawnOpts = {}) => {
  const output = opts.output !== undefined ? opts.output : "pipe";
  const stdio: ("pipe" | "inherit")[] = ["inherit", output, output];
  let env = process.env;
  if (opts.env) {
    env = { ...env, ...opts.env };
  }

  const cmdStr = cmd.join(" ");
  logger().trace(`Executing command: ${cmdStr}`);

  const proc: ChildProcess | null = baseSpawn(cmd[0], cmd.slice(1), {
    env,
    stdio,
    shell: false,
  });

  let cancelled = false;
  const cancel = () => {
    if (!cancelled && proc?.pid !== undefined) {
      treeKill(proc.pid);
    }
    cancelled = true;
  };

  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);

  proc.on("close", () => {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  });

  return { process: proc, cancel };
};

type ExecOpts = SpawnOpts;

export const exec = async (cmd: string[], opts: ExecOpts = {}) => {
  return new Promise<string>((resolve, reject) => {
    const { process, cancel } = spawn(cmd, opts);
    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject({
          code,
          stdout,
          stderr,
          command: cmd,
          message: `command failed with exit code ${code}`,
        });
      }
    });

    process.on("error", (error) => {
      reject({ message: error.message });
    });
  });
};
