import { readFileSync } from "node:fs";
import { parse, parseAllDocuments, stringify } from "yaml";
import { parseWith, type z } from "./schema.ts";

type Obj = Record<string, any>;

// a yaml file, checked against a schema
export const readYaml = <T extends z.ZodType>(
  file: string,
  schema: T,
): z.output<T> => parseWith(schema, parse(readFileSync(file, "utf-8")), file);

// the documents of a (multi-document) yaml string, minus the empty ones
export const parseDocuments = (text: string): Obj[] =>
  parseAllDocuments(text)
    .map((doc) => doc.toJSON())
    .filter(Boolean);

export const toYaml = (docs: Obj[]): string =>
  docs
    .map((doc) =>
      stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false }),
    )
    .join("---\n");
