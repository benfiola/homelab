import type { Command } from "commander";

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

// lays rows out in columns, each as wide as its widest cell and two spaces apart. a line has no
// trailing spaces.
export const align = (rows: string[][]): string[] => {
  const columns = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(0, ...rows.map((row) => (row[i] ?? "").length)),
  );
  return rows.map((row) =>
    widths
      .map((width, i) => (row[i] ?? "").padEnd(width))
      .join("  ")
      .trimEnd(),
  );
};
