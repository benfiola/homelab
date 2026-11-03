import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "../schema.ts";
import { parseDocuments, readYaml } from "../yaml.ts";

type Obj = Record<string, any>;

export interface Cluster {
  name: string;
  // where the api server and the nodes are found: nodes are <name>.<endpoint>
  endpoint: string;
  kubernetes: string;
}

export interface Disk {
  device: string;
  size?: string;
}

// what a kind of machine needs: how its disks are used, the image it installs, and any
// machine configuration that only applies to it
export interface Profile {
  name: string;
  disks: Record<string, Disk>;
  // the installer image nodes of this profile install and upgrade to
  image: string;
  // what the image factory builds that image from
  imageConfig: { filename: string; schematic: Obj };
  machineConfig?: Obj;
}

export type Role = "controlplane" | "worker";

export interface Node {
  name: string;
  hostname: string;
  profile: string;
  role: Role;
  // the network interface that gets an address by dhcp
  interface: string;
  enabled: boolean;
}

export interface Talos {
  cluster: Cluster;
  nodes: Node[];
  profiles: Record<string, Profile>;
  // machine configuration documents every node gets
  documents: Obj[];
}

const cluster = z.strictObject({
  name: z.string().min(1),
  endpoint: z.string().min(1),
  // a yaml number (1.36) isn't a version, but it is easy to write one
  kubernetes: z.union([z.string(), z.number()]).transform(String),
});

const profile = z
  .strictObject({
    disks: z.record(
      z.string(),
      z.strictObject({ device: z.string(), size: z.string().optional() }),
    ),
    image: z.string().min(1),
    imageConfig: z.strictObject({
      filename: z.string().min(1),
      schematic: z.record(z.string(), z.any()).default({}),
    }),
    machineConfig: z.record(z.string(), z.any()).optional(),
  })
  .refine((p) => p.disks.SYSTEM?.device, {
    path: ["disks", "SYSTEM", "device"],
    message: "required: the disk talos installs to",
  });

const nodes = z.strictObject({
  nodes: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        profile: z.string().min(1),
        role: z.enum(["controlplane", "worker"]),
        interface: z.string().min(1),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1),
});

const yamlFiles = (dir: string) =>
  readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();

// the talos configuration in a directory:
//   cluster.yaml     name, endpoint, kubernetes version
//   nodes.yaml       the nodes
//   profiles/*.yaml  one file per kind of machine, named for it
//   config/*.yaml    machine configuration documents for every node
export const loadTalos = (dir: string): Talos => {
  const cluster_ = readYaml(join(dir, "cluster.yaml"), cluster);

  const profiles: Record<string, Profile> = {};
  for (const file of yamlFiles(join(dir, "profiles"))) {
    const name = file.replace(/\.ya?ml$/, "");
    const { imageConfig, ...rest } = readYaml(
      join(dir, "profiles", file),
      profile,
    );
    profiles[name] = { name, ...rest, imageConfig };
  }

  const nodesPath = join(dir, "nodes.yaml");
  const nodes_ = readYaml(nodesPath, nodes).nodes.map((n): Node => {
    if (!profiles[n.profile]) {
      throw new Error(
        `${nodesPath}: ${n.name}: no profile '${n.profile}' (have: ${Object.keys(profiles).join(", ")})`,
      );
    }
    return { ...n, hostname: `${n.name}.${cluster_.endpoint}` };
  });
  const names = nodes_.map((n) => n.name);
  if (new Set(names).size !== names.length) {
    throw new Error(`${nodesPath}: node names must be unique`);
  }

  const documents = yamlFiles(join(dir, "config")).flatMap((file) =>
    parseDocuments(readFileSync(join(dir, "config", file), "utf-8")),
  );

  return { cluster: cluster_, nodes: nodes_, profiles, documents };
};
