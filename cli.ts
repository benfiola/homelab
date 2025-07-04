#!/usr/bin/env tsx
import { YamlOutputType } from "cdk8s";
import { Command, program } from "commander";
import { configDotenv } from "dotenv";
import { cp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { glob as baseGlob } from "glob";
import path from "path";
import { setTimeout } from "timers";

import { Storage } from "@google-cloud/storage";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { deepmerge } from "deepmerge-ts";
import { existsSync } from "fs";
import { join } from "shlex";
import { parse, stringify } from "yaml";
import { App } from "./utils/App";
import {
  BootstrapCallback,
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
  ResourcesOpts,
} from "./utils/CliContext";
import { exec } from "./utils/exec";
import { temporaryDirectory } from "./utils/temporaryDirectory";
const baseFolder = __dirname;

const bucketName = "homelab-8hxm62";
const clusterName = "homelab";
const clusterDns = "cluster.bulia.dev";

/**
 * Uses 'glob' but returns an iterable of absolute file paths.
 *
 * @param pattern the glob pattern
 * @returns an iterable of file paths
 */
const glob = async (pattern: string) => {
  const files = await baseGlob(pattern, { cwd: __dirname });
  return files.map((f) => path.join(__dirname, f));
};

/**
 * Performs an async sleep
 *
 * @param duration sleep duration
 * @returns
 */
const sleep = (duration: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, duration * 1000));
};

/**
 * Bootstrap deploys an application as part of an initial cluster setup.
 *
 * @param appName the app name
 * @param callback a callback attaching a cdk8s chart to the provided app
 */
async function bootstrap(_: string, callback: BootstrapCallback) {
  const app = new App();
  await callback(app);
  const manifest = app.synthYaml();

  await temporaryDirectory(async (dir) => {
    // generate manifest yaml
    const manifestFile = path.join(dir, "manifest.yaml");
    await writeFile(manifestFile, manifest);

    // apply manifest
    await exec(["kubectl", "apply", `--filename=${manifestFile}`]);
  });
}

/**
 * Generates manifests for all known applications
 *
 * NOTE: see `generateManifest` for details on how manifests are generated
 *
 * @param manifests
 */
async function generateAllManifests(entries: {
  [k: string]: ManifestsCallback;
}) {
  for (const [appName, callback] of Object.entries(entries)) {
    console.log(`generating manifests: ${appName}`);
    await generateManifests(appName, callback);
  }
}

/**
 * Delegates to an application with a 'manifest' callback to attach a cdk8s Chart object
 * to a top-level cdk8s App obejct.
 *
 * The parent cdk8s app is then used to synthesize a single manifest for the application
 *
 * @param appName the application name
 * @param callback a callback attaching a cdk8s chart to the provided app
 */
async function generateManifests(appName: string, callback: ManifestsCallback) {
  await temporaryDirectory(async (directory) => {
    const manifestsFolder = path.join(baseFolder, "manifests", appName);

    // create an app and attach chart to it
    const app = new App({
      outdir: directory,
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_APP,
    });
    await callback(app);

    // synthesize yaml
    app.synth();

    // copy created content
    await rm(manifestsFolder, { recursive: true, force: true });
    await mkdir(path.dirname(manifestsFolder), { recursive: true });
    await cp(directory, manifestsFolder, { recursive: true });
  });
}

/**
 * Generates resources for all known applications
 *
 * NOTE: see `generateResources` for details on how manifests are generated
 *
 * @param entries
 */
async function generateAllResources(entries: {
  [k: string]: [ResourcesCallback, ResourcesOpts];
}) {
  for (const [appName, [callback, opts]] of Object.entries(entries)) {
    console.log(`generating resources: ${appName}`);
    await generateResources(appName, callback, opts);
  }
}

/**
 * Helper function that downloads files from cloud storage
 *
 * @param files a map of 'cloud storage key' -> 'local path'
 */
async function downloadFromCloudStorage(files: Record<string, string>) {
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  for (const [remoteName, localPath] of Object.entries(files)) {
    const remoteFile = bucket.file(remoteName);
    console.log(`downloading ${remoteFile.cloudStorageURI} to ${localPath}`);
    await remoteFile.download({ destination: localPath });
  }
}

/**
 * Helper function that uploads files to cloud storage
 *
 * @param files a map of 'cloud storage key' -> 'local path'
 */
async function uploadToCloudStorage(files: Record<string, string>) {
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  for (const [remoteName, localPath] of Object.entries(files)) {
    if (!existsSync(localPath)) {
      throw new Error(`file '${localPath}' not found`);
    }
    const remoteFile = bucket.file(remoteName);
    console.log(`uploading ${localPath} to ${remoteFile.cloudStorageURI}`);
    await remoteFile.bucket.upload(localPath, { destination: remoteFile.name });
  }
}

const envFile = {
  ".env": path.join(__dirname, ".env"),
};

/**
 * Downloads the (sensitive) .env file from cloud storage.
 * Expected to exist at '.env'.
 */
async function envFileDownload() {
  await downloadFromCloudStorage(envFile);
}

/**
 * Uploads the (sensitive) .env file to cloud storage.
 * Expected to exist at '.env' and will fail if the file does not exist.
 */
async function envFileUpload() {
  await uploadToCloudStorage(envFile);
}

/**
 * Creates a debug pod with elevated privileges on the targeted node.
 * The host file system is mounted at /host.
 *
 * NOTE: https://www.siderolabs.com/blog/how-to-ssh-into-talos-linux/
 *
 * @param node the target node
 */
async function nodeShell(node: string) {
  const rand = randomBytes(6).toString("hex");
  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: `node-shell-${node}-${rand}`,
      namespace: "kube-system",
    },
    spec: {
      nodeSelector: {
        "kubernetes.io/hostname": `node-${node}`,
      },
      containers: [
        {
          name: "node-shell",
          image: "alpine:latest",
          args: [
            "sh",
            "-c",
            "apk add lvm2 parted vim net-tools; while true; do sleep 1; done;",
          ],
          securityContext: { privileged: true },
          volumeMounts: [
            { name: "dev", mountPath: "/dev" },
            { name: "host", mountPath: "/host" },
          ],
        },
      ],
      hostIPC: true,
      hostNetwork: true,
      hostPID: true,
      tolerations: [
        {
          effect: "NoSchedule",
          key: "node-role.kubernetes.io/control-plane",
        },
      ],
      volumes: [
        {
          name: "dev",
          hostPath: { path: "/dev" },
        },
        { name: "host", hostPath: { path: "/" } },
      ],
    },
  };

  await temporaryDirectory(async (tempDir) => {
    const manifest = path.join(tempDir, "manifest.yaml");

    console.log(`creating pod: ${pod.metadata.name}`);
    await writeFile(manifest, stringify(pod));
    await exec(["kubectl", "apply", "-f", manifest]);

    console.log(`waiting for pod to be ready`);
    await exec([
      "kubectl",
      "wait",
      "--for=condition=ready",
      `--namespace=${pod.metadata.namespace}`,
      "pod",
      pod.metadata.name,
    ]);

    let error: Error | null = null;
    try {
      console.log(`connecting to pod`);
      execSync(
        join([
          "kubectl",
          "exec",
          "-it",
          `--namespace=${pod.metadata.namespace}`,
          pod.metadata.name,
          "--",
          "sh",
          "-l",
        ]),
        { stdio: "inherit" }
      );
    } catch (e) {
      error = e as Error;
    }

    console.log(`deleting pod: ${pod.metadata.name}`);
    await exec(["kubectl", "delete", "-f", manifest]);
    if (error) {
      throw error;
    }
  });
}

interface NodeApplyConfigOpts {
  dryRun?: boolean;
  insecure?: boolean;
}

/**
 * Applies updated talos config to the target node
 *
 * @param node the target node
 */
async function talosApply(node: string, opts: NodeApplyConfigOpts = {}) {
  const dryRun = opts.dryRun !== undefined ? opts.dryRun : false;
  const insecure = opts.insecure !== undefined ? opts.insecure : false;

  const nodePatchPath = path.join(__dirname, "talos", "node.yaml");
  const nodePatch = parse((await readFile(nodePatchPath)).toString());

  const machinePatchPath = path.join(
    __dirname,
    "talos",
    `node-${node}.${clusterDns}.yaml`
  );
  const machinePatch = parse((await readFile(machinePatchPath)).toString());

  const systemDiskPath = path.join(__dirname, "talos", "system-disk.yaml");
  const systemDisk = parse((await readFile(systemDiskPath)).toString());

  const kubernetesVersion = nodePatch["machine"]["env"]["K8S"];
  const installImage = nodePatch["machine"]["env"]["IMAGE"];
  const role = machinePatch["machine"]["env"]["ROLE"];
  const secretsPath = talosCloudFiles["talos/secrets.yaml"];

  let cmd = [
    "talosctl",
    "gen",
    "config",
    `--additional-sans=${clusterDns}`,
    `--install-image=${installImage}`,
    `--kubernetes-version=${kubernetesVersion}`,
    "--output=-",
    `--output-types=${role}`,
    "--with-cluster-discovery=false",
    "--with-docs=false",
    "--with-examples=false",
    "--with-kubespan=false",
    `--with-secrets=${secretsPath}`,
    clusterName,
    `https://${clusterDns}:6443`,
  ];
  const baseConfig = parse(
    execSync(join(cmd), {
      stdio: ["inherit", "pipe", "inherit"],
    }).toString()
  );

  const config = deepmerge(baseConfig, nodePatch, machinePatch);
  const content = [config, systemDisk].map((v) => stringify(v)).join("---\n");

  if (dryRun) {
    console.log(content);
    return;
  }

  await temporaryDirectory(async (dir: string) => {
    const configPath = path.join(dir, "config.yaml");
    await writeFile(configPath, content);
    cmd = [
      "talosctl",
      `--nodes=node-${node}.${clusterDns}`,
      "apply-config",
      `--file=${configPath}`,
    ];
    if (insecure) {
      cmd.push("--insecure");
    }
    return execSync(join(cmd), { stdio: "inherit" });
  });
}

/**
 * Bootstraps an initialized cluster through the given node
 *
 * @param node the target node
 */
async function talosBootstrap(node: string) {
  const configPatchPath = path.join(
    __dirname,
    "talos",
    `node-${node}.${clusterDns}.yaml`
  );
  const configPatch = parse((await readFile(configPatchPath)).toString());

  const role = configPatch["machine"]["env"]["ROLE"];
  if (role !== "controlplane") {
    throw new Error(`node ${node} does not have 'controlplane' role.`);
  }

  let cmd = ["talosctl", `--nodes=node-${node}.${clusterDns}`, "bootstrap"];
  execSync(join(cmd), { stdio: "inherit" });
}

const talosCloudFiles = {
  "talos/secrets.yaml": path.join(__dirname, "talos", "secrets.yaml"),
};

/**
 * Downloads (sensitive) talos config files from cloud storage.
 *
 * These files are expected to exist within the `talos` subdirectory.
 */
async function talosDownload() {
  await downloadFromCloudStorage(talosCloudFiles);
}

/**
 * Obtains the administrative kubeconfig for a talos cluster via the given node
 */
async function talosGenerateTalosconfig() {
  const secretsPath = talosCloudFiles["talos/secrets.yaml"];

  const cmd = [
    "talosctl",
    `--endpoints=${clusterDns}`,
    "gen",
    "config",
    "--force",
    `--output=-`,
    "--output-types=talosconfig",
    `--with-secrets=${secretsPath}`,
    clusterName,
    `https://${clusterDns}:6443`,
  ];
  const config = parse(
    execSync(join(cmd), {
      stdio: ["inherit", "pipe", "inherit"],
    }).toString()
  );

  const nodes = [];
  const nodePatchPaths = await glob(`talos/*.${clusterDns}.yaml`);
  for (const nodePatchPath of nodePatchPaths) {
    const nodePatch = parse((await readFile(nodePatchPath)).toString());
    const node = nodePatch["machine"]["network"]["hostname"];
    nodes.push(node);
  }

  const context = config["contexts"][clusterName];
  context["endpoints"] = [clusterDns];
  context["nodes"] = nodes;

  const configPath = path.join(__dirname, "talos", "config");
  await writeFile(configPath, stringify(config));
}

/**
 * Obtains the administrative kubeconfig for a talos cluster via the given node
 *
 * @param node the target node
 */
async function talosGenerateKubeconfig(node: string) {
  const cmd = ["talosctl", `--nodes=node-${node}.${clusterDns}`, "kubeconfig"];
  execSync(join(cmd), { stdio: "inherit" });
}

/**
 * Generate new talosctl secrets
 */
async function talosGenerateSecrets() {
  const secretsPath = talosCloudFiles["talos/secrets.yaml"];

  const cmd = [
    "talosctl",
    "gen",
    "secrets",
    "--force",
    `--output-file=${secretsPath}`,
  ];
  execSync(join(cmd), { stdio: "inherit" });
}
/**
 * Upgrades the cluster to the version of talos linux defined within the talos config files.
 */
async function talosUpgrade() {
  const nodePatchPath = path.join(__dirname, "talos", "node.yaml");
  const nodePatch = parse((await readFile(nodePatchPath)).toString());

  const image = nodePatch["machine"]["env"]["IMAGE"];

  const cmd = ["talosctl", "upgrade", `--image=${image}`];
  execSync(join(cmd), { stdio: "inherit" });
}

/**
 * Upgrades the cluster to the version of kubernetes defined within the talos config files.
 *
 * @param node the target control plane node
 */
async function talosUpgradeK8s(node: string) {
  const nodePatchPath = path.join(__dirname, "talos", "node.yaml");
  const nodePatch = parse((await readFile(nodePatchPath)).toString());

  const kubernetesVersion = nodePatch["machine"]["env"]["K8S"];

  const cmd = [
    "talosctl",
    `--nodes=node-${node}.${clusterDns}`,
    "upgrade-k8s",
    `--to=${kubernetesVersion}`,
  ];
  execSync(join(cmd), { stdio: "inherit" });
}

/**
 * Uploads (sensitive) talos config files to cloud storage.
 *
 * These files are expected to exist within the `talos` subdirectory.
 * Will fail if files do not exist.
 */
async function talosUpload() {
  await uploadToCloudStorage(talosCloudFiles);
}

/**
 * Delegates to an application to generate importable cdk8s resources
 *
 * @param appName the application name
 * @param callback the callback that produces importable cdk8s resources
 * @param opts (optional) options configuring resource generation behavior
 */
async function generateResources(
  appName: string,
  callback: ResourcesCallback,
  opts?: ResourcesOpts
) {
  const shouldImport =
    opts?.shouldImport !== undefined ? opts.shouldImport : true;

  await temporaryDirectory(async (directory) => {
    // create folder to hold generated cdk8s files
    const outputFolder = path.join(directory, "output");
    await mkdir(outputFolder);

    if (shouldImport) {
      // the callback should produce a manifest file that is imported via cdk8s
      const manifestFile = path.join(directory, "manifest.yaml");
      await callback(manifestFile);
      await exec([
        "yarn",
        "run",
        "cdk8s",
        "import",
        manifestFile,
        "--language",
        "typescript",
        "--output",
        outputFolder,
      ]);
    } else {
      // the callback should directly place cdk8s resources in the output folder
      await callback(outputFolder);
    }

    // copy cdk8s resources to the correct bootstrap folder
    const folder = path.join(baseFolder, "resources", appName);
    await rm(folder, { recursive: true, force: true });
    await mkdir(path.dirname(folder), { recursive: true });
    await cp(outputFolder, folder, { recursive: true });
  });
}

(async function () {
  // load .env file if exists
  configDotenv({ path: ".env" });

  program.description("administrate the homelab");
  program.configureHelp({ sortSubcommands: true });

  // create top-level (and sub-level) commands
  const cmdApps = program.command("apps").description("run app commands");
  const cmdBootstrap = program
    .command("bootstrap")
    .description("bootstrap the cluster");
  const cmdEnv = program.command("env").description("manipulate .env files");
  cmdEnv
    .command("download")
    .description("download .env file from cloud storage")
    .action(envFileDownload);
  cmdEnv
    .command("upload")
    .description("upload .env file to cloud storage")
    .action(envFileUpload);
  const manifestsEntries: { [k: string]: ManifestsCallback } = {};
  const cmdManifests = program
    .command("manifests")
    .description("generate manifests");
  cmdManifests
    .command("all")
    .description("generate manifests for all apps")
    .action(() => generateAllManifests(manifestsEntries));
  const cmdNodes = program
    .command("nodes")
    .description("work with kubernetes nodes");
  cmdNodes
    .command("shell")
    .description("create a privileged shell on the target node")
    .argument("node")
    .action(nodeShell);
  const resourcesEntries: { [k: string]: [ResourcesCallback, ResourcesOpts] } =
    {};
  const cmdResources = program
    .command("resources")
    .description("generate cdk8s resources");
  cmdResources
    .command("all")
    .description("generate cdk8s resources for all apps")
    .action(() => generateAllResources(resourcesEntries));
  const cmdTalos = program
    .command("talos")
    .description("manipulate talos configuration");
  cmdTalos
    .command("apply")
    .description("apply talos config to target node")
    .argument("node")
    .option("--dry-run", "prints configuration without applying it", false)
    .option("--insecure", "disable authentication", false)
    .action(talosApply);
  cmdTalos
    .command("bootstrap")
    .description("bootstrap an initialized talos cluster")
    .argument("node")
    .action(talosBootstrap);
  cmdTalos
    .command("download")
    .description("download talos config files from cloud storage")
    .action(talosDownload);
  cmdTalos
    .command("generate-secrets")
    .description(
      "generates talos secret files used to initialize a new cluster"
    )
    .action(talosGenerateSecrets);
  cmdTalos
    .command("generate-kubeconfig")
    .description("obtain kubeconfig from talos cluster")
    .argument("node")
    .action(talosGenerateKubeconfig);
  cmdTalos
    .command("generate-talosconfig")
    .description("generates the talosconfig file for this cluster")
    .action(talosGenerateTalosconfig);
  cmdTalos
    .command("upgrade")
    .description(
      "upgrade talos linux to the version defined within the talos config files"
    )
    .action(talosUpgrade);
  cmdTalos
    .command("upgrade-k8s")
    .description(
      "upgrade kubernetes to the version defined within the talos config files"
    )
    .action(talosUpgradeK8s);
  cmdTalos
    .command("upload")
    .description("upload talos config files to cloud storage")
    .action(talosUpload);

  // find all app scripts
  let scripts = await glob("apps/*.ts");
  scripts = scripts.sort();
  for (const script of scripts) {
    // attempt import of app module
    let module;
    try {
      module = await import(script);
    } catch (e) {
      console.warn(`import failed: ${script}`);
      console.error(e);
      continue;
    }

    // parse app name from path
    const appName = path.basename(script, ".ts");

    // obtain root-level, app command as needed
    let cmdApp: Command;

    // create context (used by imported module to register commands and attach callbacks to existing commands)
    const context: CliContext = {
      bootstrap: (callback) => {
        // register new 'bootstrap' subcommand
        cmdBootstrap
          .command(appName)
          .description(`bootstrap '${appName}'`)
          .action(() => bootstrap(appName, callback));
      },
      command: (callback) => {
        // allow app to define custom command line tooling
        cmdApp =
          cmdApp ||
          cmdApps.command(appName).description(`run '${appName}' commands`);
        callback(cmdApp);
      },
      manifests: (callback) => {
        // collect manifests callback for use with `generateAllManifests`
        manifestsEntries[appName] = callback;

        // register new 'manifests' subcommand
        cmdManifests
          .command(appName)
          .description(`generate '${appName}' manifests`)
          .action(() => generateManifests(appName, callback));
      },
      resources: (callback, opts?: ResourcesOpts) => {
        // collect resources callback for use with `generateAllResources`
        resourcesEntries[appName] = [callback, opts || {}];

        // register new 'generate resources' subcommand
        cmdResources
          .command(appName)
          .description(`generate '${appName}' cdk8s resources`)
          .action(() => generateResources(appName, callback, opts));
      },
    };

    // register commands via context
    const register = module.default;
    try {
      register(context);
    } catch (e) {
      console.warn(`cli registration failed: ${script}`);
      console.error(e);
      continue;
    }
  }

  try {
    await program.parseAsync();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
