import { spawn } from "node:child_process";
import type { Run } from "./context.ts";

export const run: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [
        options.interactive
          ? "inherit"
          : options.input === undefined
            ? "ignore"
            : "pipe",
        "inherit",
        "inherit",
      ],
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
    if (options.input !== undefined && !options.interactive) {
      child.stdin!.end(options.input);
    }
  });
