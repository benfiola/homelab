import { App } from "cdk8s";
import { glob, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import path, { basename, dirname, join } from "path";
import * as age from "./age";
import { waitFor } from "./async";
import * as bitwarden from "./bitwarden";
import * as config from "./config";
import { exec } from "./exec";
import * as gcloud from "./gcloud";
import * as kubernetes from "./kubernetes";
import { logger } from "./logger";
import { renderTemplate, textblock } from "./strings";
import * as talos from "./talos";
import * as templates from "./templates";
import { getTempy } from "./tempy";
import { Vault } from "./vault";
import { stringify } from "./yaml";

const getEnabledNodes = async (configDir: string) => {
  const nodeNames = await config.listNodes(configDir);
  const allNodes = await Promise.all(
    nodeNames.map((n) => config.getNodeConfig(configDir, n)),
  );
  return allNodes.filter((n) => n.enabled);
};

interface ApplySystemConfigOpts {
  dryRun?: boolean;
  insecure?: boolean;
  nodes?: string[];
}

export const applySystemConfig = async (
  configDir: string,
  opts: ApplySystemConfigOpts = {},
) => {
  const nodes =
    opts.nodes || (await getEnabledNodes(configDir)).map((n) => n.name);

  const systemConfigs: Record<string, Record<any, any>> = {};

  const clusterConfig = await config.getClusterConfig(configDir);
  const secretsPath = config.getSecretsPath("talos", configDir);

  const apply = async (node: string) => {
    const nodeConfig = await config.getNodeConfig(configDir, node);
    const systemConfig = await talos.getSystemConfig(
      clusterConfig,
      nodeConfig,
      secretsPath,
    );

    systemConfigs[node] = systemConfig;
    if (opts.dryRun) {
      return;
    }

    await talos.applySystemConfig(nodeConfig, systemConfig, {
      insecure: opts.insecure,
    });
  };

  await Promise.all(nodes.map(apply));

  return systemConfigs;
};

type BootstrapStep =
  | "generate-manifests"
  | "deploy-crds"
  | "deploy-cilium"
  | "install-flux"
  | "initialize-vault"
  | "wait-for-cluster-ready";

interface BootstrapOpts {
  onStepStart?: (step: BootstrapStep) => void;
}

export const bootstrap = async (
  configDir: string,
  manifestsDir: string,
  opts: BootstrapOpts,
) => {
  await Promise.all([
    async () => {
      opts.onStepStart?.("generate-manifests");
      generateManifests(configDir, manifestsDir);
    },
    async () => {
      opts.onStepStart?.("wait-for-cluster-ready");
      waitForClusterReady();
    },
  ]);

  opts.onStepStart?.("deploy-crds");
  await deployCrds(manifestsDir);

  opts.onStepStart?.("deploy-cilium");
  await deployCilium(manifestsDir);

  opts.onStepStart?.("install-flux");
  await installFlux(configDir, manifestsDir);

  opts.onStepStart?.("initialize-vault");
  await initializeVault(configDir);
};

const pushAppsSecretsToVault = async (configDir: string) => {
  const appsSecrets = await config.getAppsSecrets(configDir);
  const vaultSecrets = await config.getVaultSecrets(configDir);

  await kubernetes.portForward(
    "vault",
    "services/vault-active",
    [8200],
    async ([port]) => {
      const address = `http://localhost:${port}`;
      const vault = new Vault(address, vaultSecrets.rootToken);

      for (const [roleName, roleData] of Object.entries(appsSecrets.roles)) {
        logger().info(`Creating ${roleName} policy...`);
        const policies: string[] = [];
        if (!roleData.secret) {
          policies.push(textblock`
            path "secrets/*" {
              capabilities = ["read", "list"]
            }
          `);
        } else {
          policies.push(textblock`
            path "secrets/data/${roleData.secret}" {
              capabilities = ["read", "list"]
            }

            path "secrets/data/${roleData.secret}/*" {
              capabilities = ["read", "list"]
            }
          `);
        }
        if (roleData.roles) {
          policies.push(textblock`
            path "auth/kubernetes/role" {
              capabilities = ["list"]
            }

            path "auth/kubernetes/role/*" {
              capabilities = ["read"]
            }
          `);
        }
        if (roleData.policies) {
          policies.push(textblock`
            path "sys/policies/acl/*" {
              capabilities = ["read"]
            }
          `);
        }
        await vault.writePolicy(roleName, policies.join("\n\n"));

        logger().info(`Creating ${roleName} role...`);
        await vault.write(`/auth/kubernetes/role/${roleName}`, {
          bound_service_account_names: roleData["service-account"],
          bound_service_account_namespaces: roleData.namespace || "",
          policies: roleName,
          ttl: "1h",
        });
      }

      for (const [app, appSecrets] of Object.entries(appsSecrets.secrets)) {
        logger().info(`Putting ${app} secrets...`);
        await vault.putKV("secrets", app, appSecrets);
      }
    },
  );
};

const pushSecretsToStorage = async (
  secret: config.Secret,
  configDir: string,
) => {
  const storageConfig = await config.getStorageConfig(configDir);
  const localPath = config.getSecretsPath(secret, configDir);

  const name = basename(localPath);
  const dest = `gs://${storageConfig.bucket}/${name}`;

  await gcloud.login();

  const tempy = await getTempy();
  await tempy.temporaryFileTask(async (tempPath) => {
    await age.encrypt(localPath, tempPath, storageConfig.publicKey);
    await gcloud.copy(tempPath, dest);
  });
};

export const pushSecrets = async (secret: config.Secret, configDir: string) => {
  if (secret === "storage") {
    const storageConfig = await config.getStorageConfig(configDir);
    throw new Error(
      `storage key must be stored in Bitwarden manually (item id: ${storageConfig.privateKeyItemId})`,
    );
  } else if (secret === "apps") {
    await pushAppsSecretsToVault(configDir);
  } else {
    await pushSecretsToStorage(secret, configDir);
  }
};

export const pullSecrets = async (configDir: string) => {
  const storageConfig = await config.getStorageConfig(configDir);

  const encryptionKey = await bitwarden.getSecret(
    storageConfig.privateKeyItemId,
  );
  await writeFile(
    config.getSecretsPath("storage", configDir),
    stringify({ privateKey: encryptionKey }),
  );

  const storageSecrets = await config.getStorageSecrets(configDir);

  await gcloud.login();

  const tempy = await getTempy();
  const bucket = storageConfig.bucket;
  await Promise.all(
    config.secrets
      .filter((s) => s !== "storage")
      .map(async (s) => {
        const localPath = config.getSecretsPath(s, configDir);
        const remotePath = `gs://${bucket}/${basename(localPath)}`;
        await tempy.temporaryFileTask(async (tempPath) => {
          await gcloud.copy(remotePath, tempPath);
          await age.decrypt(tempPath, localPath, storageSecrets.privateKey);
        });
      }),
  );
};

const deployCrds = async (manifestsDir: string) => {
  logger().info("Applying crd manifests...");
  const crdManifest = join(manifestsDir, "crds", "manifest.yaml");
  await kubernetes.apply(crdManifest, {
    forceConflicts: true,
    serverSide: true,
  });

  logger().info("Waiting for crds to be established...");
  await kubernetes.wait(null, "crd", {
    all: true,
    for: "condition=Established",
    timeout: "5m",
  });
};

const deployCilium = async (manifestsDir: string) => {
  logger().info("Applying network policies...");
  const networkPolicyManifest = join(
    manifestsDir,
    "network-policy",
    "manifest.yaml",
  );
  await kubernetes.apply(networkPolicyManifest);

  logger().info("Applying cilium manifest...");
  const ciliumManifest = join(manifestsDir, "cilium", "manifest.yaml");
  await kubernetes.apply(ciliumManifest);

  logger().info("Waiting for cilium to be ready...");
  await waitFor(async () => {
    await kubernetes.get("cilium", "daemonsets/cilium");
    await kubernetes.rollout("cilium", "daemonsets/cilium");
  });
};

type FluxBootstrapCommand = {
  command: string[];
  env: Record<string, string>;
};

const buildFluxBootstrapCommand = async (
  fluxConfig: config.FluxConfig,
  fluxSecrets: config.FluxSecrets,
): Promise<FluxBootstrapCommand> => {
  const command = ["flux", "bootstrap"];
  const env: Record<string, string> = {};

  const url = new URL(fluxConfig.repo);
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/");
    const owner = parts[1];
    const repository = parts[2].replace(".git", "");

    command.push(
      "github",
      `--owner=${owner}`,
      "--personal",
      `--repository=${repository}`,
    );
    if (fluxConfig.branch) {
      command.push(`--branch=${fluxConfig.branch}`);
    }

    env.GITHUB_TOKEN = fluxSecrets.token;
  } else {
    throw new Error(`flux repo type not implemented`);
  }

  command.push("--network-policy=false", "--path=./flux");

  return { command, env };
};

const normalizeRepoUrl = (raw: string) => {
  const u = URL.parse(raw);
  if (!u) throw new Error(`invalid repo url: ${raw}`);
  return `${u.hostname}${u.pathname.replace(/\.git$/, "")}`;
};

const isFluxBootstrapped = async (fluxConfig: config.FluxConfig) => {
  let kustomization: Record<string, any>;
  try {
    kustomization = await kubernetes.get(
      "flux-system",
      "kustomizations/flux-system",
    );
  } catch (error) {
    if (
      error instanceof kubernetes.ResourceNotFoundError ||
      error instanceof kubernetes.ResourceTypeNotFoundError
    ) {
      logger().debug("flux-system kustomization not found");
      return false;
    }
    throw error;
  }

  const gitRepo = await kubernetes.get(
    "flux-system",
    `gitrepositories/${kustomization.spec.sourceRef.name}`,
  );

  const currentBranch = gitRepo.spec.ref.branch;
  const desiredBranch = fluxConfig.branch ?? "main";
  if (currentBranch !== desiredBranch) {
    logger().debug(
      `flux branch mismatch: ${currentBranch} != ${desiredBranch}`,
    );
    return false;
  }

  const currentRepo = normalizeRepoUrl(gitRepo.spec.url);
  const desiredRepo = normalizeRepoUrl(fluxConfig.repo);
  if (currentRepo !== desiredRepo) {
    logger().debug(`flux repo mismatch: ${currentRepo} != ${desiredRepo}`);
    return false;
  }

  return true;
};

const installFlux = async (configDir: string, manifestsDir: string) => {
  const fluxConfig = await config.getFluxConfig(configDir);

  logger().info("Checking if flux-system is current...");
  let fluxBootstrapped = await isFluxBootstrapped(fluxConfig);

  if (!fluxBootstrapped) {
    logger().info("Bootstrapping flux...");

    const fluxSecrets = await config.getFluxSecrets(configDir);

    const { command, env } = await buildFluxBootstrapCommand(
      fluxConfig,
      fluxSecrets,
    );

    await exec(command, { env });
  }

  logger().info("Deploying flux-bootstrap kustomization...");
  const fluxAppListManifest = join(
    manifestsDir,
    "flux-bootstrap",
    "manifest.yaml",
  );
  await kubernetes.apply(fluxAppListManifest);
};

const initializeVault = async (configDir: string) => {
  const tempy = await getTempy();

  logger().info("Waiting for instances running...");
  const statefulSet = await waitFor(() =>
    kubernetes.get("vault", "statefulsets/vault"),
  );
  await waitFor(
    () =>
      kubernetes.wait("vault", "pod", {
        for: "jsonpath={.status.phase}=Running",
        selector: "app.kubernetes.io/name=vault",
      }),
    { timeout: 900 },
  );
  const numReplicas: number = statefulSet.spec.replicas;

  logger().info("Port-forwarding primary instance...");
  await kubernetes.portForward(
    "vault",
    "pods/vault-0",
    [8200],
    async ([port]) => {
      const client = new Vault(`http://localhost:${port}`);

      const status = await client.getStatus();

      if (!status.initialized) {
        logger().info("Initializing...");
        const secrets = await client.init();

        logger().info("Pushing unseal key to pods...");
        await tempy.temporaryFileTask(async (file) => {
          await writeFile(file, secrets.unsealKey);
          for (let i = 0; i < numReplicas; i++) {
            const dest = `vault/vault-${i}:/vault/data/unseal-key`;
            await kubernetes.cp(file, dest);
          }
        });

        logger().info("Writing local vault secrets file...");
        const secretsPath = config.getSecretsPath("vault", configDir);
        await writeFile(secretsPath, stringify(secrets));

        logger().info("Pushing vault secrets file to cloud...");
        await pushSecrets("vault", configDir);
      }

      const vaultSecrets = await config.getVaultSecrets(configDir);
      client.token = vaultSecrets.rootToken;

      logger().info("Wait for unseal...");
      await waitFor(async () => {
        const status = await client.getStatus();
        if (status.sealed) {
          throw new Error("still sealed");
        }
      });

      const secretsEngines = await client.getSecretsEngines();
      if (!secretsEngines["secrets/"]) {
        logger().info("Enabling secrets engine...");
        await client.enableSecretsEngine("secrets/", "kv2", {
          description: "homelab secrets",
        });
      }

      const authEngines = await client.getAuthEngines();
      if (!authEngines["kubernetes/"]) {
        logger().info("Enabling auth engine...");
        await client.enableAuthEngine("kubernetes");
      }

      logger().info("Configuring auth engine...");
      const cert = await kubernetes.exec("vault", "pods/vault-0", [
        "cat",
        "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      ]);
      await client.write("/auth/kubernetes/config", {
        kubernetes_host: "https://kubernetes.default.svc.cluster.local:443",
        kubernetes_ca_cert: cert,
      });
    },
  );

  logger().info(`Pushing apps secrets...`);
  await pushSecrets("apps", configDir);
};

export const waitForClusterReady = async () => {
  await waitFor(kubernetes.clusterInfo);
};

export const generateClientConfig = async (
  configDir: string,
  output: string,
) => {
  const cluster = await config.getClusterConfig(configDir);
  const secretsPath = config.getSecretsPath("talos", configDir);
  const nodes = await getEnabledNodes(configDir);

  const clientConfig = await talos.getClientConfig(cluster, nodes, secretsPath);
  const content = stringify(clientConfig);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content);
};

interface GenerateManifestsOpts {
  filter?: string[];
}

const findSynthAppManifest = async (outputPath: string, appId: string) => {
  const manifestPaths: string[] = [];
  const manifestsGlob = glob(`${outputPath}/{[0-9]*-${appId},${appId}}.yaml`);
  for await (const manifestPath of manifestsGlob) {
    manifestPaths.push(manifestPath);
  }
  if (manifestPaths.length === 0) {
    throw new Error(`app ${appId} manifest not found`);
  }
  if (manifestPaths.length > 1) {
    throw new Error(`multiple ${appId} manifests found`);
  }
  return manifestPaths[0];
};

const processSynthAppManifest = async (
  appId: string,
  synthManifestPath: string,
  outputPath: string,
) => {
  const appFolder = join(outputPath, appId);
  await mkdir(appFolder, { recursive: true });

  const manifestPath = join(appFolder, "manifest.yaml");
  await rename(synthManifestPath, manifestPath);

  const kustomizationPath = join(appFolder, "kustomization.yaml");
  const kustomizationContent = stringify({
    resources: ["manifest.yaml"],
    sortOptions: { order: "fifo" },
  });
  await writeFile(kustomizationPath, kustomizationContent);
};

export const generateManifests = async (
  configDir: string,
  output: string,
  opts: GenerateManifestsOpts = {},
) => {
  const appsConfig = await config.getAppsConfig(configDir);

  const app = new App({ outdir: output, outputFileExtension: ".yaml" });
  await templates.attachCharts(app, appsConfig, configDir, {
    filter: opts.filter,
  });

  await rm(output, { force: true, recursive: true });
  app.synth();

  const promises = app.charts.map(async (chart) => {
    const synthManifestPath = await findSynthAppManifest(output, chart.node.id);
    await processSynthAppManifest(chart.node.id, synthManifestPath, output);
  });
  await Promise.all(promises);
};

interface GenerateNetworkConfigOpts {
  filter?: string[];
}

export const generateNetworkConfig = async (
  configDir: string,
  output: string,
  opts: GenerateNetworkConfigOpts = {},
) => {
  const [networkConfig, secrets] = await Promise.all([
    config.getNetworkConfig(configDir),
    config.getNetworkSecrets(configDir),
  ]);

  await rm(output, { force: true, recursive: true });
  await mkdir(output);

  const entries =
    opts.filter && opts.filter.length > 0
      ? networkConfig.outputs.filter((e) => opts.filter!.includes(e.file))
      : networkConfig.outputs;

  await Promise.all(
    entries.map(async (entry) => {
      const templatePath = path.join(configDir, entry.template);
      const template = (await readFile(templatePath)).toString();
      const rendered = renderTemplate(template, {
        secrets,
        inputs: entry.inputs,
      });
      await writeFile(path.join(output, entry.file), rendered);
    }),
  );
};

export const generateTalosImages = async (
  configDir: string,
  version: string,
) => {
  const clusterConfig = await config.getClusterConfig(configDir);

  interface Image {
    oci: string;
    raw: string;
  }

  const images: Record<string, Image> = {};
  const generateTalosImage = async (hw: config.HardwareName) => {
    const imageConfig = clusterConfig.hardware[hw].imageConfig;
    const filename = imageConfig.filename;
    const schematic = imageConfig.schematic;

    const id = await talos.createSchematic(schematic);

    const oci = `factory.talos.dev/metal-installer/${id}:v${version}`;
    const raw = `https://factory.talos.dev/image/${id}/v${version}/${filename}`;

    images[hw] = { oci, raw };
  };

  const hws = Object.keys(clusterConfig.hardware) as config.HardwareName[];
  await Promise.all(hws.map(generateTalosImage));

  return images;
};

interface RefreshAssetsOpts {
  filter?: string[];
}

export const refreshAssets = async (
  output: string,
  opts: RefreshAssetsOpts = {},
) => {
  await rm(output, { force: true, recursive: true });
  await templates.fetchAssets(output, { filter: opts.filter });
};

export const talosctl = async (configDir: string, args: string[]) => {
  const cluster = await config.getClusterConfig(configDir);
  const nodes = await getEnabledNodes(configDir);

  await talos.talosctl(cluster, nodes, args);
};

interface UpgradeTalosOpts {
  nodes?: string[];
}

export const upgradeTalos = async (
  configDir: string,
  opts: UpgradeTalosOpts = {},
) => {
  const cluster = await config.getClusterConfig(configDir);
  const nodeNames =
    opts.nodes || (await getEnabledNodes(configDir)).map((n) => n.name);
  const nodes = await Promise.all(
    nodeNames.map((n) => config.getNodeConfig(configDir, n)),
  );

  const buckets: Record<string, string[]> = {};
  nodes.forEach((n) => {
    const hwType = cluster.hardware[n.hardware];
    const image = hwType.image;
    buckets[image] = buckets[image] ?? [];
    buckets[image].push(n.name);
  });

  for (const bucket of Object.values(buckets)) {
    const bucketStr = bucket.join(",");
    await talosctl(configDir, [`--nodes=${bucketStr}`, "upgrade"]);
  }
};
