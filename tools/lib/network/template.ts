type Obj = Record<string, any>;

// fills in `{{ a.b.c }}` with the value at that path of the data. a path that isn't there is an
// error, never an empty string: a configuration with a missing secret must not be written.
// templates have no conditions or filters: anything more belongs in code.
export const renderTemplate = (
  template: string,
  data: Obj,
  origin = "template",
): string =>
  template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    return String(resolve(data, path, origin));
  });

const lookup = (data: Obj, path: string): unknown =>
  path
    .split(".")
    .reduce<any>(
      (value, key) =>
        value !== null && typeof value === "object" ? value[key] : undefined,
      data,
    );

// the value at a path of the data; a path that isn't there is an error
export const resolve = (data: Obj, path: string, origin: string): unknown => {
  const value = lookup(data, path);
  if (value === undefined || value === null) {
    throw new Error(`${origin}: '${path}' is not defined`);
  }
  return value;
};

// constructs of other template languages, refused rather than left in the output
const unsupported = /\{%|\{#/;

export const checkTemplate = (template: string, origin: string) => {
  const match = unsupported.exec(template);
  if (match) {
    throw new Error(
      `${origin}: '${match[0]}' is not supported; templates only fill in {{ values }}`,
    );
  }
};

// fills in the `{{ }}` of every string in a value, however deep
export const renderValues = (
  value: unknown,
  data: Obj,
  origin: string,
): unknown => {
  if (typeof value === "string") {
    checkTemplate(value, origin);
    return renderTemplate(value, data, origin);
  }
  if (Array.isArray(value)) {
    return value.map((v) => renderValues(v, data, origin));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, renderValues(v, data, origin)]),
    );
  }
  return value;
};
