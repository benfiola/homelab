import { deepmergeCustom } from "deepmerge-ts";
import { writeFile } from "fs/promises";
import { join } from "path";
import { parseAllDocuments } from "yaml";
import { ClusterConfig, ImageSchematic, NodeConfig } from "./config";
import { exec } from "./exec";
import { getTempy } from "./tempy";
import { stringify } from "./yaml";

interface TalosctlApplyConfigOpts {
  file?: string;
  insecure?: boolean;
  nodes?: string[];
}

const _talosctlApplyConfig = async (opts: TalosctlApplyConfigOpts = {}) => {
  let cmd = ["talosctl", "apply-config"];
  if (opts.file) {
    cmd.push(`--file=${opts.file}`);
  }
  if (opts.insecure !== undefined) {
    cmd.push(`--insecure=${opts.insecure}`);
  }
  if (opts.nodes) {
    cmd.push(`--nodes=${opts.nodes.join(",")}`);
  }

  await exec(cmd, { output: "inherit" });
};

interface TalosctlGenConfigOpts {
  additionalSans?: string[];
  dnsDomain?: string;
  installDisk?: string;
  installImage?: string;
  kubernetesVersion?: string;
  output?: string;
  outputTypes?: ("controlplane" | "worker" | "talosconfig")[];
  withClusterDiscovery?: boolean;
  withDocs?: boolean;
  withExamples?: boolean;
  withKubespan?: boolean;
  withSecrets?: string;
}

const _talosctlGenConfig = async (
  clusterName: string,
  clusterEndpoint: string,
  opts: TalosctlGenConfigOpts,
) => {
  let cmd = ["talosctl", "gen", "config", clusterName, clusterEndpoint];
  if (opts.additionalSans) {
    cmd.push(`--additional-sans=${opts.additionalSans.join(",")}`);
  }
  if (opts.dnsDomain) {
    cmd.push(`--dns-domain=${opts.dnsDomain}`);
  }
  if (opts.installDisk) {
    cmd.push(`--install-disk=${opts.installDisk}`);
  }
  if (opts.installImage) {
    cmd.push(`--install-image=${opts.installImage}`);
  }
  if (opts.kubernetesVersion) {
    cmd.push(`--kubernetes-version=${opts.kubernetesVersion}`);
  }
  if (opts.output) {
    cmd.push(`--output=${opts.output}`);
  }
  if (opts.outputTypes) {
    cmd.push(`--output-types=${opts.outputTypes.join(",")}`);
  }
  if (opts.withClusterDiscovery !== undefined) {
    cmd.push(`--with-cluster-discovery=${opts.withClusterDiscovery}`);
  }
  if (opts.withDocs !== undefined) {
    cmd.push(`--with-docs=${opts.withDocs}`);
  }
  if (opts.withExamples !== undefined) {
    cmd.push(`--with-examples=${opts.withExamples}`);
  }
  if (opts.withKubespan !== undefined) {
    cmd.push(`--with-kubespan=${opts.withKubespan}`);
  }
  if (opts.withSecrets) {
    cmd.push(`--with-secrets=${opts.withSecrets}`);
  }

  const stdout = (await exec(cmd)).toString();

  return parseAllDocuments(stdout).map((doc) => doc.toJSON());
};

export const getClientConfig = async (
  cluster: ClusterConfig,
  nodes: NodeConfig[],
  secretsPath: string,
) => {
  const configs = await _talosctlGenConfig(
    cluster.name,
    `https://${cluster.endpoint}:6443`,
    {
      output: "-",
      outputTypes: ["talosconfig"],
      withSecrets: secretsPath,
    },
  );
  const config = configs[0];

  const context = config.contexts[cluster.name];
  context.endpoints = [cluster.endpoint];
  context.nodes = nodes.map((n) => n.hostname);

  return config;
};

interface ApplySystemConfigOpts {
  insecure?: boolean;
}

export const applySystemConfig = async (
  node: NodeConfig,
  configs: Record<any, any>[],
  opts: ApplySystemConfigOpts = {},
) => {
  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (dir: string) => {
    const file = join(dir, "config.yaml");
    const content = stringify(...configs);
    await writeFile(file, content);

    await _talosctlApplyConfig({
      file,
      insecure: opts.insecure,
      nodes: [node.hostname],
    });
  });
};

export const createSchematic = async (schematic: ImageSchematic) => {
  const url = `https://factory.talos.dev/schematics`;
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(schematic),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.url}`);
  }
  const data = await response.json();
  const id = data.id;
  if (!id || typeof id !== "string") {
    throw new Error(`unexpected image factory response`);
  }
  return id;
};

const identityMerge = deepmergeCustom<any>({
  mergeArrays: (streams, utils, meta) => {
    const merged = [...streams[0]];

    const find = (toFind: any) => {
      return merged.findIndex((curr: any) => {
        return (
          curr.apiVersion === toFind.apiVersion &&
          curr.kind === toFind.kind &&
          curr.name === toFind.name
        );
      });
    };

    for (let i = 1; i < streams.length; i++) {
      for (const obj of streams[i]) {
        const index = find(obj);
        if (index === -1) {
          merged.push(obj);
        } else {
          merged[index] = identityMerge(merged[index], obj);
        }
      }
    }

    return merged;
  },
});

export const getSystemConfig = async (
  cluster: ClusterConfig,
  node: NodeConfig,
  baseConfigs: Record<string, any>[],
  secretsPath: string,
) => {
  const hardware = cluster.hardware[node.hardware];

  const buildDerivedConfigs = () => {
    const dhcp = {
      apiVersion: "v1alpha1",
      kind: "DHCPv4Config",
      name: node.interface,
    };

    const hostname = {
      apiVersion: "v1alpha1",
      kind: "HostnameConfig",
      auto: "off",
      hostname: node.hostname,
    };

    const volumes: Record<any, any>[] = [];
    for (const [name, disk] of Object.entries(hardware.disks)) {
      if (name === "SYSTEM") {
        continue;
      }

      const kind = ["STATE", "EPHEMERAL", "IMAGECACHE"].includes(name)
        ? "VolumeConfig"
        : "RawVolumeConfig";
      volumes.push({
        apiVersion: "v1alpha1",
        kind,
        name,
        provisioning: {
          diskSelector: {
            match: `disk.dev_path == '${disk.device}'`,
          },
          minSize: disk.size,
          maxSize: disk.size,
          grow: true,
        },
      });
    }
    return [dhcp, hostname, ...volumes];
  };

  const genConfigs = await _talosctlGenConfig(
    cluster.name,
    `https://${cluster.endpoint}:6443`,
    {
      additionalSans: [cluster.endpoint],
      installDisk: hardware.disks["SYSTEM"].device,
      installImage: hardware.image,
      kubernetesVersion: cluster.kubernetes,
      output: "-",
      outputTypes: [node.role],
      withClusterDiscovery: false,
      withDocs: false,
      withExamples: false,
      withKubespan: false,
      withSecrets: secretsPath,
    },
  );
  const derivedConfigs = buildDerivedConfigs();

  const result = identityMerge(genConfigs, baseConfigs, derivedConfigs);
  return result;
};

const processTalosctlNodeArgs = (nodes: NodeConfig[], args: string[]) => {
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.name, n.hostname]));

  const toReturn = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    let nodeNames: string[];
    if (arg.startsWith("--nodes=")) {
      nodeNames = arg.split("=")[1].split(",");
    } else if (arg === "--nodes" || arg === "-n") {
      nodeNames = args[++i].split(",");
    } else {
      toReturn.push(arg);
      continue;
    }

    toReturn.push(`--nodes=${nodeNames.map((n) => nodeMap[n] ?? n).join(",")}`);
  }

  return toReturn;
};

const processTalosctlUpgradeImageArg = (
  cluster: ClusterConfig,
  nodes: NodeConfig[],
  args: string[],
) => {
  if (!args.includes("upgrade")) {
    return args;
  }

  const imageArgs = args.filter((a) => a.startsWith("--image"));
  if (imageArgs.length !== 0) {
    return args;
  }

  const nodeImages: Record<string, string> = {};
  for (const node of nodes) {
    const image = cluster.hardware[node.hardware].image;
    nodeImages[node.name] = image;
    nodeImages[node.hostname] = image;
  }

  const images: Set<string> = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let nodeIds: string[];
    if (arg.startsWith("--nodes=")) {
      nodeIds = arg.split("=")[1].split(",");
    } else if (arg.startsWith("--nodes")) {
      const nextArg = args[++i];
      nodeIds = nextArg.split(",");
    } else {
      continue;
    }

    for (const nodeId of nodeIds) {
      const image = nodeImages[nodeId];
      images.add(image);
    }
  }

  if (images.size !== 1) {
    throw new Error(`unable to resolve single image for nodes`);
  }
  const [image] = images;

  const toReturn = [...args, `--image=${image}`];
  return toReturn;
};

const processTalosctlUpgradeK8sToArg = (
  cluster: ClusterConfig,
  args: string[],
) => {
  if (!args.includes("upgrade-k8s")) {
    return args;
  }

  const imageArgs = args.filter((a) => a.startsWith("--to"));
  if (imageArgs.length !== 0) {
    return args;
  }

  const toReturn = [...args, `--to=${cluster.kubernetes}`];
  return toReturn;
};

export const talosctl = async (
  cluster: ClusterConfig,
  nodes: NodeConfig[],
  args: string[],
) => {
  args = processTalosctlNodeArgs(nodes, args);
  args = processTalosctlUpgradeImageArg(cluster, nodes, args);
  args = processTalosctlUpgradeK8sToArg(cluster, args);

  args = ["talosctl", ...args];
  await exec(args, { output: "inherit" });
};
