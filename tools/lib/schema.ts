import { z } from "zod";

export { z };

const where = (path: PropertyKey[]) =>
  path
    .map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`))
    .join("");

// parses a value with a schema; fails with every problem found, each at its place in `label`
export const parseWith = <T extends z.ZodType>(
  schema: T,
  value: unknown,
  label: string,
): z.output<T> => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(
    result.error.issues
      .map((issue) => `${label}${where(issue.path)}: ${issue.message}`)
      .join("\n"),
  );
};
