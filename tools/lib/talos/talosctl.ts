import { capture, run, withTempFile } from "../exec.ts";
import { parseDocuments, toYaml } from "../yaml.ts";
import type { Profile, Node, Talos } from "./config.ts";

type Obj = Record<string, any>;

// `talosctl gen config`, from the cluster's secrets bundle so that every run (and every node) agrees
const generate = async (
  talos: Talos,
  secrets: string,
  args: string[],
): Promise<Obj[]> => {
  const { cluster } = talos;
  const stdout = await capture(
    "talosctl",
    [
      "gen",
      "config",
      cluster.name,
      `https://${cluster.endpoint}:6443`,
      "--output=-",
      `--with-secrets=${secrets}`,
      ...args,
    ],
    { context: "talosctl gen config" },
  );
  return parseDocuments(stdout);
};

// what talos generates for a node's role, before any of our configuration is merged over it
export const generateNodeConfig = (
  talos: Talos,
  node: Node,
  profile: Profile,
  secrets: string,
) =>
  generate(talos, secrets, [
    `--additional-sans=${talos.cluster.endpoint}`,
    `--install-disk=${profile.disks.SYSTEM.device}`,
    `--install-image=${profile.image}`,
    `--kubernetes-version=${talos.cluster.kubernetes}`,
    `--output-types=${node.role}`,
    "--with-cluster-discovery=false",
    "--with-docs=false",
    "--with-examples=false",
    "--with-kubespan=false",
  ]);

// the client configuration (talosconfig), pointing at the cluster's endpoint and its enabled nodes
export const generateClientConfig = async (
  talos: Talos,
  secrets: string,
): Promise<Obj> => {
  const [config] = await generate(talos, secrets, [
    "--output-types=talosconfig",
  ]);
  const context = config.contexts[talos.cluster.name];
  context.endpoints = [talos.cluster.endpoint];
  context.nodes = talos.nodes.filter((n) => n.enabled).map((n) => n.hostname);
  return config;
};

export const applyConfig = (
  node: Node,
  docs: Obj[],
  opts: { insecure?: boolean } = {},
) =>
  withTempFile("config.yaml", toYaml(docs), (file) =>
    run(
      "talosctl",
      [
        "apply-config",
        `--file=${file}`,
        ...(opts.insecure === undefined ? [] : [`--insecure=${opts.insecure}`]),
        `--nodes=${node.hostname}`,
      ],
      { interactive: true },
    ),
  );

export const talosctl = (args: string[]) =>
  run("talosctl", args, { interactive: true });

// registers an image's schematic with the image factory, which returns the id the image is named by
export const createSchematic = async (schematic: Obj): Promise<string> => {
  const response = await fetch("https://factory.talos.dev/schematics", {
    method: "POST",
    body: JSON.stringify(schematic),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.url} (${response.status})`);
  }
  const { id } = (await response.json()) as { id?: unknown };
  if (typeof id !== "string" || !id) {
    throw new Error("unexpected image factory response");
  }
  return id;
};

// the node arguments talosctl takes: --nodes a,b / --nodes=a,b / -n a,b
const nodeArgument = (
  args: string[],
  i: number,
): { names: string[]; skip: number } | undefined => {
  const arg = args[i];
  if (arg.startsWith("--nodes=")) {
    return { names: arg.slice("--nodes=".length).split(","), skip: 0 };
  }
  if ((arg === "--nodes" || arg === "-n") && args[i + 1] !== undefined) {
    return { names: args[i + 1].split(","), skip: 1 };
  }
  return undefined;
};

// makes talosctl easier to use with this cluster, by filling in what is known:
//  - nodes may be given by name (samoyed) rather than by hostname
//  - `upgrade` gets the --image of its nodes' profile, which has to be one image
//  - `upgrade-k8s` gets --to the cluster's kubernetes version
export const translateArguments = (talos: Talos, args: string[]): string[] => {
  const hostnames = new Map(talos.nodes.map((n) => [n.name, n.hostname]));
  const images = new Map(
    talos.nodes.flatMap((n) => {
      const image = talos.profiles[n.profile].image;
      return [
        [n.name, image],
        [n.hostname, image],
      ] as const;
    }),
  );

  const result: string[] = [];
  const named = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const nodes = nodeArgument(args, i);
    if (!nodes) {
      result.push(args[i]);
      continue;
    }
    i += nodes.skip;
    nodes.names.forEach((name) => named.add(name));
    result.push(
      `--nodes=${nodes.names.map((name) => hostnames.get(name) ?? name).join(",")}`,
    );
  }

  if (args.includes("upgrade") && !args.some((a) => a.startsWith("--image"))) {
    const found = new Set([...named].map((name) => images.get(name)));
    if (found.size !== 1 || found.has(undefined)) {
      throw new Error(
        "unable to resolve a single image for the nodes (give --image, or nodes of one profile)",
      );
    }
    result.push(`--image=${[...found][0]}`);
  }
  if (args.includes("upgrade-k8s") && !args.some((a) => a.startsWith("--to"))) {
    result.push(`--to=${talos.cluster.kubernetes}`);
  }
  return result;
};
