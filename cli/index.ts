#!/usr/bin/env tsx
import { program } from "commander";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { getClusterConfig, getNodeConfig } from "./config";
import {
  applyTalosSystemConfig,
  getKubeConfig,
  getTalosClientConfig,
  getTalosSystemConfig,
} from "./talos";
import { stringify } from "./yaml";

interface CmdApplySystemConfiguration {
  insecure?: boolean;
}

const cmdApplyConfig = async (
  node: string,
  opts: CmdApplySystemConfiguration = {}
) => {
  const clusterConfig = await getClusterConfig();
  const nodeConfig = await getNodeConfig(node);
  const configs = await getTalosSystemConfig(clusterConfig, nodeConfig);
  await applyTalosSystemConfig(nodeConfig, configs, opts);
};

interface CmdGenerateKubeconfigOpts {
  output: string;
}

const cmdGenerateKubeconfig = async (
  node: string,
  opts: CmdGenerateKubeconfigOpts
) => {
  const nodeConfig = await getNodeConfig(node);
  const kubeConfig = await getKubeConfig(nodeConfig);
  await mkdir(dirname(opts.output), { recursive: true });
  const content = stringify(kubeConfig);
  await writeFile(opts.output, content);
};

interface CmdGenerateTalosconfigOpts {
  output: string;
}

const cmdGenerateTalosconfig = async (opts: CmdGenerateTalosconfigOpts) => {
  const clusterConfig = await getClusterConfig();
  const clientConfig = await getTalosClientConfig(clusterConfig);
  await mkdir(dirname(opts.output), { recursive: true });
  const content = stringify(clientConfig);
  await writeFile(opts.output, content);
};

const cmdPrintConfig = async (node: string) => {
  const clusterConfig = await getClusterConfig();
  const nodeConfig = await getNodeConfig(node);
  const configs = await getTalosSystemConfig(clusterConfig, nodeConfig);
  console.log(stringify(...configs));
};

const main = async () => {
  program
    .command("apply-config")
    .argument("node")
    .option("--insecure")
    .action(cmdApplyConfig);
  program
    .command("generate-kubeconfig")
    .argument("node")
    .option("--output", "", join(homedir(), ".kube", "config"))
    .action(cmdGenerateKubeconfig);
  program
    .command("generate-talosconfig")
    .option("--output", "", join(homedir(), ".talos", "config"))
    .action(cmdGenerateTalosconfig);
  program
    .command("print-configuration")
    .argument("node")
    .action(cmdPrintConfig);
  await program.parseAsync();
};

(async function () {
  await main();
})();
