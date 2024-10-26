import { exec as baseExec } from "child_process";
import { join as shlexJoin } from "shlex";

/**
 * Executes a command.
 *
 * The returned promise is rejected with the error and stderr when the command fails.
 * The returned promise is resolved with stdout if the command succeeds.
 *
 * @param command the command
 * @returns a promise
 */
export const exec = async (command: string[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    return baseExec(
      shlexJoin(command),
      { maxBuffer: 10 ** 10 },
      (error, stdout, stderr) => {
        if (error !== null) {
          return reject({ error, stderr });
        }
        return resolve(stdout);
      }
    );
  });
};
