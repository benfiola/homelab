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

// flux applies a namespace-less object to 'default', and identifies every object, cluster-scoped ones
// included, as <namespace>_<name>_<group>_<kind>. so every object is stamped (kubernetes ignores the
// namespace on cluster-scoped kinds): changing a stamp changes the id, and flux prunes the object.
export const stampNamespace = <T extends Obj>(
  items: T[],
  namespace: string,
): T[] =>
  items.map((obj) =>
    obj?.metadata?.namespace
      ? obj
      : { ...obj, metadata: { ...obj?.metadata, namespace } },
  );

// json with sorted keys, so values that differ only in key order compare equal
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
