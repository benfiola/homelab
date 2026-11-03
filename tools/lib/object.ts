type Obj = Record<string, any>;

// removes undefined values, recursively (empty arrays and objects stay)
export const compact = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(compact) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, compact(v)]),
    ) as T;
  }
  return value;
};

// json with sorted keys, so values that differ only in key order compare equal
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
