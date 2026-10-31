import type { Talos } from "./config.ts";

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
