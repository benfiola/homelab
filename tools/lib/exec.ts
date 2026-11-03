import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// runs a program and returns what it prints. a failure is reported as `context` and the program's
// own stderr.
export const capture = async (
  command: string,
  args: string[],
  {
    context = command,
    ...options
  }: { context?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      ...options,
      maxBuffer: 1024 ** 3,
    });
    return stdout;
  } catch (e: any) {
    if (e.code === "ENOENT") {
      throw new Error(`${command} is not installed (it is in the dev shell)`);
    }
    throw new Error(`${context}: ${String(e.stderr || e.message).trim()}`);
  }
};

// runs a program that prints to this terminal. its stdin is `input`, or this terminal's if
// `interactive`, or nothing.
export const run = (
  command: string,
  args: string[],
  options: { input?: string; interactive?: boolean } = {},
): Promise<void> =>
  new Promise((resolve, reject) => {
    let stdin: "inherit" | "pipe" | "ignore" = "ignore";
    if (options.interactive) {
      stdin = "inherit";
    } else if (options.input !== undefined) {
      stdin = "pipe";
    }
    const child = spawn(command, args, {
      stdio: [stdin, "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
    if (stdin === "pipe") {
      child.stdin!.end(options.input);
    }
  });

// a file for a program that takes a path: private, and gone once `use` is done
export const withTempFile = async <T>(
  name: string,
  content: string,
  use: (file: string) => Promise<T>,
): Promise<T> => {
  const dir = mkdtempSync(join(tmpdir(), "homelab-"));
  try {
    const file = join(dir, name);
    writeFileSync(file, content, { mode: 0o600 });
    return await use(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
