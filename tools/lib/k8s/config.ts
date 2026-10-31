import { readFileSync } from "node:fs";
import { join } from "node:path";

type Obj = Record<string, any>;

export const configMap = (name: string, data: Record<string, string>): Obj => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: { name },
  data,
});

// the contents of files in an app's directory, keyed by file name
export const files = (
  dir: string,
  ...names: string[]
): Record<string, string> =>
  Object.fromEntries(
    names.map((name) => [name, readFileSync(join(dir, name), "utf-8")]),
  );
