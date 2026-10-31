import type { Profile, Node, Talos } from "./config.ts";
import { mergeDocuments } from "./merge.ts";

type Obj = Record<string, any>;

// the volumes configuration for the disks a profile lists besides the one talos
// installs to: talos' own volumes (state, ephemeral, image cache) are configured, and the
// rest are provisioned raw, for other uses (e.g. piraeus)
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
