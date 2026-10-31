import type { Command } from "commander";

// an exit code for when the program has finished
export const exit = (code: number) => {
  process.exitCode = code;
};

// runs a program. commander reports a mistake in the arguments itself; anything else that is
// thrown is reported as an error here.
export const run = async (
  program: Command,
  argv = process.argv.slice(2),
): Promise<never> => {
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e: any) {
    console.error(`error: ${e.message ?? e}`);
    exit(1);
  }
  return process.exit(process.exitCode ?? 0);
};
