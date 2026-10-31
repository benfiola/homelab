type Obj = Record<string, any>;

// drops `creationTimestamp: null` (controller-gen, in crds) and empty label and annotation maps (helm)
export const tidy = (items: Obj[]): Obj[] =>
  items.map((obj) => {
    if (!obj.metadata) {
      return obj;
    }
    const metadata = { ...obj.metadata };
    if (metadata.creationTimestamp === null) {
      delete metadata.creationTimestamp;
    }
    for (const field of ["annotations", "labels"]) {
      if (metadata[field] && Object.keys(metadata[field]).length === 0) {
        delete metadata[field];
      }
    }
    return { ...obj, metadata };
  });

// flux applies a namespace-less object to 'default', and identifies every object, cluster-scoped ones
// included, as <namespace>_<name>_<group>_<kind>. so every object is stamped (kubernetes ignores the
// namespace on cluster-scoped kinds): changing a stamp changes the id, and flux prunes the object.
export const stampNamespace = (items: Obj[], namespace: string): Obj[] =>
  items.map((obj) =>
    obj.metadata?.namespace
      ? obj
      : { ...obj, metadata: { ...obj.metadata, namespace } },
  );

export const validate = (origin: string, objects: Obj[]): Obj[] => {
  objects.forEach((obj, i) => {
    for (const field of ["apiVersion", "kind"]) {
      if (typeof obj?.[field] !== "string") {
        throw new Error(`${origin}: object ${i} has no '${field}'`);
      }
    }
    if (typeof obj.metadata?.name !== "string") {
      throw new Error(
        `${origin}: ${obj.kind} (object ${i}) has no 'metadata.name'`,
      );
    }
  });
  return objects;
};
