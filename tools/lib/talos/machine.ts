import type { Profile, Node, Talos } from "./config.ts";

type Obj = Record<string, any>;

const isRecord = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// documents are the same document if their apiVersion, kind and name are. legacy documents have none
// of the three, so they are all one document: that is how a plain `machine:`/`cluster:` file lands on
// the generated one.
const sameDocument = (a: Obj, b: Obj) =>
  a.apiVersion === b.apiVersion && a.kind === b.kind && a.name === b.name;

// inside a document, list entries are the same entry if they have the same (defined) name
const sameEntry = (a: unknown, b: unknown) =>
  isRecord(a) && isRecord(b) && a.name !== undefined && a.name === b.name;

const mergeList = (
  lists: unknown[][],
  same: (a: any, b: any) => boolean,
): unknown[] => {
  const merged: unknown[] = [...lists[0]];
  for (const list of lists.slice(1)) {
    for (const item of list) {
      const index = merged.findIndex((existing) => same(existing, item));
      if (index >= 0) {
        merged[index] = merge(merged[index], item);
      } else if (isRecord(item) || !merged.includes(item)) {
        merged.push(item);
      }
    }
  }
  return merged;
};

// merges machine configuration, later values over earlier ones:
//  - mappings merge key by key
//  - lists merge entry by entry, where entries with the same name are one entry (and the
//    list of documents merges by document identity, see sameDocument)
//  - anything else is replaced
export const merge = (...values: unknown[]): any => {
  const defined = values.filter((v) => v !== undefined);
  if (defined.length > 0 && defined.every(Array.isArray)) {
    return mergeList(defined as unknown[][], sameEntry);
  }
  if (defined.length > 0 && defined.every(isRecord)) {
    const merged: Obj = {};
    for (const key of new Set(defined.flatMap((v) => Object.keys(v)))) {
      merged[key] = merge(...defined.map((v) => v[key]));
    }
    return merged;
  }
  return defined.at(-1);
};

// merges lists of documents: the documents of every list, later ones merged over earlier ones
// that are the same document
export const mergeDocuments = (...lists: Obj[][]): Obj[] =>
  mergeList(lists, sameDocument) as Obj[];

// volumes for the disks a profile lists besides the one talos installs to: talos' own (state,
// ephemeral, image cache) are configured, and the rest are provisioned raw (e.g. for piraeus)
const volumes = (profile: Profile): Obj[] =>
  Object.entries(profile.disks)
    .filter(([name]) => name !== "SYSTEM")
    .map(([name, disk]) => ({
      apiVersion: "v1alpha1",
      kind: ["STATE", "EPHEMERAL", "IMAGECACHE"].includes(name)
        ? "VolumeConfig"
        : "RawVolumeConfig",
      name,
      provisioning: {
        diskSelector: { match: `disk.dev_path == '${disk.device}'` },
        minSize: disk.size,
        maxSize: disk.size,
        grow: true,
      },
    }));

// what is derived from the node alone: how it gets an address, its name, and its disks
export const nodeDocuments = (node: Node, profile: Profile): Obj[] => [
  { apiVersion: "v1alpha1", kind: "DHCPv4Config", name: node.interface },
  {
    apiVersion: "v1alpha1",
    kind: "HostnameConfig",
    auto: "off",
    hostname: node.hostname,
  },
  ...volumes(profile),
];

// a node's machine configuration, as documents: what `talosctl gen config` generates for its role,
// then the configuration every node gets, its profile's, and what is derived from the node
export const machineConfig = (
  talos: Talos,
  node: Node,
  generated: Obj[],
): Obj[] => {
  const profile = talos.profiles[node.profile];
  return mergeDocuments(
    generated,
    talos.documents,
    profile.machineConfig ? [profile.machineConfig] : [],
    nodeDocuments(node, profile),
  );
};
