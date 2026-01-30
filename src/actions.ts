import { App } from "cdk8s";
import { glob, mkdir, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { createInterface } from "readline/promises";
import { waitFor } from "./async";
import * as config from "./config";
import { exec } from "./exec";
import * as gcloud from "./gcloud";
import * as kubernetes from "./kubernetes";
import { logger } from "./logger";
import { textblock } from "./strings";
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

  const apply = async (node: string) => {
    const clusterConfig = await config.getClusterConfig(configDir);
    const nodeConfig = await config.getNodeConfig(configDir, node);
    const secretsPath = await config.getSecretsPath("talos", configDir);
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
  | "pull-secrets"
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
  opts.onStepStart?.("generate-manifests");
  await generateManifests(configDir, manifestsDir);

  opts.onStepStart?.("pull-secrets");
  await pullSecrets(configDir);

  opts.onStepStart?.("wait-for-cluster-ready");
  await waitForClusterReady();

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
  const path = await config.getSecretsPath(secret, configDir);

  const name = basename(path);
  const dest = `gs://${storageConfig.bucket}/${name}`;

  await gcloud.login();

  await gcloud.copy(path, dest);
};

export const pushSecrets = async (secret: config.Secret, configDir: string) => {
  if (secret === "apps") {
    await pushAppsSecretsToVault(configDir);
  } else {
    await pushSecretsToStorage(secret, configDir);
  }
};

export const pullSecrets = async (configDir: string) => {
  const storageConfig = await config.getStorageConfig(configDir);

  await gcloud.login();

  const bucket = storageConfig.bucket;
  await Promise.all(
    config.secrets.map(async (s) => {
      const localPath = await config.getSecretsPath(s, configDir);
      const remotePath = `gs://${bucket}/${basename(localPath)}`;
      return gcloud.copy(remotePath, localPath);
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
    } else {
      throw error;
    }
  }

  const gitRepo = await kubernetes.get(
    "flux-system",
    `gitrepositories/${kustomization.spec.sourceRef.name}`,
  );
  const currentBranch = gitRepo.spec.ref.branch;
  const desiredBranch = fluxConfig.branch ?? "main";
  if (currentBranch !== desiredBranch) {
    logger().debug(
      `flux-system git repository branch is different (${currentBranch} != ${desiredBranch})`,
    );
    return false;
  }

  const currentUrl = gitRepo.spec.url;
  const currentUrlParts = URL.parse(currentUrl);
  if (currentUrlParts === null) {
    throw new Error(`invalid flux-system url: ${currentUrl}`);
  }
  const desiredUrlParts = URL.parse(fluxConfig.repo);
  if (desiredUrlParts === null) {
    throw new Error(`invalid flux config url: ${fluxConfig.repo}`);
  }
  if (currentUrlParts.hostname !== desiredUrlParts.hostname) {
    logger().debug(
      `flux-system git repository url hostname is different (${currentUrlParts.hostname} != ${desiredUrlParts.hostname})`,
    );
    return false;
  }

  const currentUrlPath = currentUrlParts.pathname.replace(".git", "");
  const desiredUrlPath = desiredUrlParts.pathname.replace(".git", "");
  if (currentUrlPath !== desiredUrlPath) {
    logger().debug(
      `flux-system git repository url path is different (${currentUrlPath} != ${desiredUrlPath})`,
    );
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
        const secretsPath = await config.getSecretsPath("vault", configDir);
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
  const secretsPath = await config.getSecretsPath("talos", configDir);
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

interface AnalyzeHubbleFlowsOpts {
  onFlow?: (flow: any) => void;
}

const includedFlowVerdicts = ["FORWARDED", "AUDIT", "DROPPED"];

const shouldFilterFlow = (data: any) => {
  if (data.is_reply) {
    // flow should already be captured via request - ignore reply.
    return true;
  }

  if (data.trace_observation_point) {
    // ignore trace flows
    return true;
  }

  if (includedFlowVerdicts.indexOf(data.verdict) === -1) {
    // ignore flow verdicts that aren't accepted/denied
    return true;
  }

  const flags = data.l4?.TCP?.flags;
  if (flags && !flags.SYN && !flags.PSH) {
    // ignore tcp traffic that isn't connection init or data push
    return true;
  }

  const dropReason = data.drop_reason;
  if ([139, 151].indexOf(dropReason) !== -1) {
    // ignore 'STALE_OR_UNROUTABLE_IP' dropped traffic
    // ignore 'UNSUPPORTED_L3_PROTOCOL' dropped traffic
    return true;
  }

  const ingressAllowedBy = data.ingress_allowed_by ?? [];
  for (const item of ingressAllowedBy) {
    const labels = getLabelMap(item.labels);
    for (const [key, value] of Object.entries(labels)) {
      if (
        key === "reserved:io.cilium.policy.derived-from" &&
        value === "allow-localhost-ingress"
      ) {
        // ignore traffic that's forwarded by default
        return true;
      }
    }
  }

  return false;
};

interface HealthFlowSubject {
  type: "health";
}

interface HostFlowSubject {
  type: "host";
}

interface NodeFlowSubject {
  name: string;
  type: "node";
}

interface PodFlowSubject {
  component?: string;
  gateway?: string;
  k8sApp?: string;
  pod?: string;

  namespace: string;
  type: "pod";
}

interface UnknownFlowSubject {
  type: "unknown";
}

interface WorldFlowSubject {
  value: string;
  type: "world";
}

export type FlowSubject =
  | HealthFlowSubject
  | HostFlowSubject
  | NodeFlowSubject
  | PodFlowSubject
  | UnknownFlowSubject
  | WorldFlowSubject;

const getLabelMap = (labels: string[]) => {
  const labelMap: Record<string, string> = {};
  for (const label of labels) {
    const parts = label.split("=");
    if (parts.length === 1) {
      labelMap[parts[0]] = "";
    } else {
      labelMap[parts[0]] = parts.slice(1).join("=");
    }
  }
  return labelMap;
};

const getFlowSubject = (
  data: any,
  nodeIps: Record<string, string>,
  source: boolean,
): FlowSubject => {
  const labels = source ? data.source.labels : data.destination.labels;
  const labelMap = getLabelMap(labels);

  const namespace = labelMap["k8s:io.kubernetes.pod.namespace"];
  if (namespace) {
    return {
      type: "pod",
      namespace,

      component: labelMap["k8s:app.kubernetes.io/component"],
      k8sApp: labelMap["k8s:k8s-app"],
      gateway: labelMap["k8s:gateway.envoyproxy.io/owning-gateway-name"],
      pod: labelMap["k8s:app.kubernetes.io/name"],
    };
  } else if (labelMap["reserved:health"] === "") {
    return { type: "health" };
  } else if (labelMap["reserved:host"] === "") {
    return { type: "host" };
  } else if (labelMap["reserved:remote-node"] === "") {
    const ip = source ? data.IP?.source : data.IP?.destination;
    const node = nodeIps[ip];
    if (!node) {
      throw new Error(`unrecognized node ip: ${ip}`);
    }
    return { type: "node", name: node };
  } else if (labelMap["reserved:world"] === "") {
    const ip = source ? data.IP?.source : data.IP?.destination;
    return { type: "world", value: ip };
  } else if (labelMap["reserved:unknown"] === "") {
    return { type: "unknown" };
  }

  throw new Error(`unrecognized flow: ${JSON.stringify(data, null, 2)}`);
};

export type FlowVerdict = "allowed" | "denied";

const getFlowVerdict = (data: any): FlowVerdict => {
  const verdict = data.verdict;
  if (["FORWARDED"].indexOf(verdict) !== -1) {
    return "allowed";
  } else if (["AUDIT", "DROPPED"].indexOf(verdict) !== -1) {
    return "denied";
  }

  throw new Error(`unexpected verdict: ${verdict}`);
};

export type FlowDirection = "ingress" | "egress";

const getFlowDirection = (data: any): FlowDirection => {
  const direction = data.traffic_direction;
  if (direction === "EGRESS") {
    return "egress";
  } else if (direction === "INGRESS") {
    return "ingress";
  }

  throw new Error(`unexpected direction: ${direction}`);
};

interface TCPFlowProtocol {
  type: "tcp";
  port: number;
}

interface UDPFlowProtocol {
  type: "udp";
  port: number;
}

interface ICMPV4FlowProtocol {
  type: "icmpv4";
  icmpType: number;
}

interface ICMPV6FlowProtocol {
  type: "icmpv6";
  icmpType: number;
}

export type FlowProtocol =
  | ICMPV4FlowProtocol
  | ICMPV6FlowProtocol
  | TCPFlowProtocol
  | UDPFlowProtocol;

const getFlowProtocol = (data: any): FlowProtocol => {
  const icmpv4 = data.l4?.ICMPv4;
  const icmpv6 = data.l4?.ICMPv6;
  const tcp = data.l4?.TCP;
  const udp = data.l4?.UDP;

  if (icmpv4) {
    const icmpType = icmpv4.type;
    return { type: "icmpv4", icmpType };
  } else if (icmpv6) {
    const icmpType = icmpv6.type;
    return { type: "icmpv6", icmpType };
  } else if (tcp) {
    const port = tcp.destination_port;
    return { type: "tcp", port };
  } else if (udp) {
    const port = udp.destination_port;
    return { type: "udp", port };
  }

  const protocols = Object.keys(data.l4 ?? {});
  const protocol = protocols.length > 0 ? protocols[0] : "unknwon";
  throw new Error(`unexpected protocol: ${protocol}`);
};

const getFlowPolicy = (data: any) => {
  if (data.ingress_allowed_by && data.ingress_allowed_by.length > 0) {
    return data.ingress_allowed_by[0].name;
  }
  if (data.egress_allowed_by && data.egress_allowed_by.length > 0) {
    return data.egress_allowed_by[0].name;
  }
  return undefined;
};

export interface Flow {
  raw: Record<string, any>;
  source: FlowSubject;
  destination: FlowSubject;
  verdict: FlowVerdict;
  direction: FlowDirection;
  port: FlowProtocol;
  policy?: string;
}

const createFlow = (data: any, nodeIps: Record<string, string>): Flow => {
  const source = getFlowSubject(data, nodeIps, true);
  const destination = getFlowSubject(data, nodeIps, false);
  const verdict = getFlowVerdict(data);
  const direction = getFlowDirection(data);
  const port = getFlowProtocol(data);
  const policy = getFlowPolicy(data);

  return {
    source,
    destination,
    verdict,
    direction,
    port,
    raw: data,
    policy,
  };
};

const getNodeIps = async () => {
  const data = await kubernetes.get(null, "ciliumnodes");
  const nodeIps: Record<string, string> = {};
  for (const item of data.items) {
    const name = item.metadata.name;
    for (const address of item.spec.addresses) {
      nodeIps[address.ip] = name;
    }
  }
  return nodeIps;
};

export const analyzeHubbleFlows = async (
  stream: NodeJS.ReadableStream,
  opts: AnalyzeHubbleFlowsOpts = {},
) => {
  const nodeIps = await getNodeIps();

  const lineReader = createInterface({ input: stream });

  for await (const line of lineReader) {
    if (line === "") {
      continue;
    }

    let data: Record<string, any>;
    try {
      data = JSON.parse(line).flow;
    } catch (e) {
      throw new Error(`non-JSON line detected: ${line}`);
    }

    if (!data) {
      continue;
    }

    if (shouldFilterFlow(data)) {
      continue;
    }

    const flow = createFlow(data, nodeIps);
    opts.onFlow?.(flow);
  }
};
