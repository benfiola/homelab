import { execa, ExecaError } from "execa";
import { logger } from "./logger";

export { ExecaError as ExecError };

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
  output?: "pipe" | "inherit";
}

export const exec = async (cmd: string[], opts: SpawnOpts = {}) => {
  const output = opts.output ?? "pipe";
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;

  logger().trace(`Executing command: ${cmd.join(" ")}`);

  const result = await execa(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env,
    stdout: output,
    stderr: output,
    stdin: "inherit",
  });

  return result.stdout;
};
