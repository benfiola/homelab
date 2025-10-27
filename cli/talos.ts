import { execSync } from "child_process";
import deepmerge from "deepmerge";
import { readFile, writeFile } from "fs/promises";
import { join as pathJoin } from "path";
import { join as shlexJoin } from "shlex";
import { parse } from "yaml";
import { ClusterConfig, getNodeConfig, listNodes, NodeConfig } from "./config";
import { getTempy } from "./tempy";
import { stringify } from "./yaml";

const configDir = pathJoin(__dirname, "..", "config");
const secretsPath = pathJoin(configDir, "secrets.yaml");

interface TalosctlApplyOpts {
  nodes: string[];
  file: string;
  insecure?: boolean;
}

const talosctlApply = async (opts: TalosctlApplyOpts) => {
  let cmd = [
    "talosctl",
    "apply",
    `--nodes=${opts.nodes.join(",")}`,
    `--file=${opts.file}`,
  ];
  if (opts.insecure) {
    cmd.push("--insecure");
  }

  execSync(shlexJoin(cmd), { stdio: "inherit" });
};

interface TalosctlGenConfigOpts {
  additionalSans?: string[];
  installImage?: string;
  kubernetesVersion?: string;
  outputTypes?: "controlplane" | "worker" | "talosconfig";
  withSecrets?: string;
}

const talosctlGenConfig = async (
  name: string,
  endpoint: string,
  opts: TalosctlGenConfigOpts
) => {
  let cmd = [
    "talosctl",
    "gen",
    "config",
    "--output=-",
    "--with-cluster-discovery=false",
    "--with-docs=false",
    "--with-examples=false",
    "--with-kubespan=false",
  ];
  if (opts.additionalSans) {
    cmd.push(`--additional-sans=${opts.additionalSans.join(",")}`);
  }
  if (opts.installImage) {
    cmd.push(`--install-image=${opts.installImage}`);
  }
  if (opts.kubernetesVersion) {
    cmd.push(`--kubernetes-version=${opts.kubernetesVersion}`);
  }
  if (opts.outputTypes) {
    cmd.push(`--output-types=${opts.outputTypes}`);
  }
  if (opts.withSecrets) {
    cmd.push(`--with-secrets=${opts.withSecrets}`);
  }
  cmd.push(name, endpoint);
  const output = execSync(shlexJoin(cmd), {
    stdio: ["inherit", "pipe", "inherit"],
  }).toString();

  const data: Record<any, any> = await parse(output);
  return data;
};

interface TalosctlKubectlOpts {
  nodes?: string[];
}

export const talosctlKubeconfig = async (
  file: string,
  opts: TalosctlKubectlOpts
) => {
  let cmd = ["talosctl", "kubeconfig", file];
  if (opts.nodes) {
    cmd.push(`--nodes=${opts.nodes.join(",")}`);
  }
  execSync(shlexJoin(cmd), { stdio: "inherit" });
};

export const getTalosSystemConfig = async (
  clusterConfig: ClusterConfig,
  nodeConfig: NodeConfig
) => {
  const hardwareConfig = clusterConfig.hardware[nodeConfig.hardware];

  const baseConfig = await talosctlGenConfig(
    clusterConfig.name,
    `https://${clusterConfig.endpoint}:6443`,
    {
      additionalSans: [clusterConfig.endpoint],
      installImage: hardwareConfig.image,
      kubernetesVersion: clusterConfig.kubernetes,
      outputTypes: nodeConfig.role,
      withSecrets: secretsPath,
    }
  );
  const clusterPatch = clusterConfig.baseTalosConfig;
  const nodePatch: Record<any, any> = {
    machine: {
      install: {
        disk: hardwareConfig.disks["SYSTEM"].device,
      },
      network: {
        hostname: nodeConfig.hostname,
      },
    },
  };
  const machineConfig = deepmerge(baseConfig, clusterPatch, nodePatch);

  const volumeConfigs = [];
  for (const [name, disk] of Object.entries(hardwareConfig.disks)) {
    if (name === "SYSTEM") {
      continue;
    }
    let volumeConfig = {
      apiVersion: "v1alpha1",
      kind: "VolumeConfig",
      name,
      provisioning: {
        diskSelector: {
          match: `disk.dev_path == ${disk.device}`,
        },
        maxSize: disk.size!,
        grow: true,
      },
    };
    volumeConfigs.push(volumeConfig);
  }

  return [machineConfig, ...volumeConfigs];
};

interface ApplyTalosSystemConfig {
  insecure?: boolean;
}

export const applyTalosSystemConfig = async (
  nodeConfig: NodeConfig,
  configs: Record<any, any>[],
  opts: ApplyTalosSystemConfig = {}
) => {
  const tempy = await getTempy();

  await tempy.temporaryDirectoryTask(async (tempDir: string) => {
    const configFile = pathJoin(tempDir, "config.yaml");
    const content = stringify(...configs);
    await writeFile(configFile, content);
    await talosctlApply({
      file: configFile,
      nodes: [nodeConfig.hostname],
      insecure: opts.insecure,
    });
  });
};

export const getTalosClientConfig = async (clusterConfig: ClusterConfig) => {
  const talosconfig = await talosctlGenConfig(
    clusterConfig.name,
    `https://${clusterConfig.endpoint}:6443`,
    {
      outputTypes: "talosconfig",
      withSecrets: secretsPath,
    }
  );

  const context = talosconfig.contexts[clusterConfig.name];
  context.endpoints = [clusterConfig.endpoint];
  context.nodes = [];
  for (const node of await listNodes()) {
    const nodeConfig = await getNodeConfig(node);
    context.nodes.push(nodeConfig.hostname);
  }

  return talosconfig;
};

export const getKubeConfig = async (nodeConfig: NodeConfig) => {
  const tempy = await getTempy();

  const data = await tempy.temporaryDirectoryTask(async (tempDir) => {
    const file = pathJoin(tempDir, "kubeconfig.yaml");
    await talosctlKubeconfig(file, { nodes: [nodeConfig.hostname] });
    const content = (await readFile(file)).toString();
    const data = await parse(content);
    return data;
  });

  return data;
};
