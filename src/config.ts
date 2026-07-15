import { readFile } from "fs/promises";
import { join } from "path";
import { parse, parseAllDocuments } from "yaml";
import * as zod from "zod";
import { renderTemplate } from "./strings";

const loadYaml = async <T>(
  schema: zod.ZodType<T>,
  path: string,
): Promise<T> => {
  const raw = (await readFile(path)).toString();
  return schema.parseAsync(parse(raw));
};

const hardwareNameSchema = zod.union([zod.literal("rpi4"), zod.literal("tc")]);

export type HardwareName = zod.infer<typeof hardwareNameSchema>;

const imageSchematicSchema = zod.object({
  overlay: zod
    .object({
      image: zod.string(),
      name: zod.string(),
      options: zod.record(zod.string(), zod.any()),
    })
    .optional(),
  customization: zod
    .object({
      systemExtensions: zod
        .object({
          officialExtensions: zod.array(zod.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ImageSchematic = zod.infer<typeof imageSchematicSchema>;

const diskConfigSchema = zod.object({
  device: zod.string(),
  size: zod.string().optional(),
});

const hardwareConfigSchema = zod.object({
  disks: zod.record(zod.string(), diskConfigSchema),
  image: zod.string(),
  imageConfig: zod.object({
    filename: zod.string(),
    schematic: imageSchematicSchema,
  }),
});

const clusterConfigSchema = zod.object({
  apiVersion: zod.literal("v1alpha1"),
  kind: zod.literal("HomelabClusterConfig"),
  endpoint: zod.string(),
  hardware: zod.record(hardwareNameSchema, hardwareConfigSchema),
  kubernetes: zod.string(),
  name: zod.string(),
});

export type ClusterConfig = zod.infer<typeof clusterConfigSchema>;

const isClusterConfig = (a: any): a is ClusterConfig => {
  return a.kind === "HomelabClusterConfig";
};

const roleSchema = zod.union([
  zod.literal("controlplane"),
  zod.literal("worker"),
]);

const nodeConfigSchema = zod.object({
  apiVersion: zod.literal("v1alpha1"),
  kind: zod.literal("HomelabNodeConfig"),
  enabled: zod.boolean().default(true),
  hardware: hardwareNameSchema,
  hostname: zod.string(),
  name: zod.string().default(""),
  role: roleSchema,
  interface: zod.string(),
});

export type NodeConfig = zod.infer<typeof nodeConfigSchema>;

const isNodeConfig = (a: any): a is NodeConfig => {
  return a.kind === "HomelabNodeConfig";
};

const clusterDocumentSchema = zod.union([
  clusterConfigSchema,
  nodeConfigSchema,
  zod.record(zod.string(), zod.any()),
]);

const parseClusterConfig = async (configDir: string) => {
  const path = join(configDir, "cluster.yaml");
  const configStr = (await readFile(path)).toString();
  const documents = parseAllDocuments(configStr);
  return Promise.all(
    documents.map((doc) => clusterDocumentSchema.parseAsync(doc.toJSON())),
  );
};

const isBaseTalosConfig = (a: any): a is Record<string, any> => {
  return !isClusterConfig(a) && !isNodeConfig(a);
};

export const getBaseTalosConfig = async (configDir: string) => {
  const parsed = await parseClusterConfig(configDir);
  return parsed.filter(isBaseTalosConfig);
};

export const getClusterConfig = async (configDir: string) => {
  const parsed = await parseClusterConfig(configDir);
  const configs = parsed.filter(isClusterConfig);
  if (configs.length !== 1) {
    throw new Error(`found ${configs.length} cluster configs`);
  }
  return configs[0];
};

const processNodes = (cluster: ClusterConfig, nodes: NodeConfig[]) => {
  const suffix = `.${cluster.endpoint}`;
  const prefix = "node-";
  nodes.forEach(
    (n) => (n.name = n.hostname.replace(suffix, "").replace(prefix, "")),
  );
};

export const getNodeConfig = async (configDir: string, node: string) => {
  const parsed = await parseClusterConfig(configDir);
  const cluster = await getClusterConfig(configDir);
  const nodes = parsed.filter(isNodeConfig);
  processNodes(cluster, nodes);
  const configs = nodes.filter((n) => n.name === node);
  if (configs.length !== 1) {
    throw new Error(`found ${configs.length} node configs`);
  }
  return configs[0];
};

export const listNodes = async (configDir: string) => {
  const parsed = await parseClusterConfig(configDir);
  const cluster = await getClusterConfig(configDir);
  const nodes = parsed.filter(isNodeConfig);
  processNodes(cluster, nodes);
  const nodeNames = nodes.map((n) => n.name);
  nodeNames.sort();
  return nodeNames;
};

const appConfigSchema = zod
  .object({
    dependencies: zod.array(zod.string()).default([]),
    id: zod.string().optional(),
    flux: zod.boolean().default(true),
    options: zod.record(zod.string(), zod.any()).default({}),
    template: zod.string(),
  })
  .transform((data) => ({
    ...data,
    id: data.id ?? data.template,
  }));

export type AppConfig = zod.infer<typeof appConfigSchema>;

const appsConfigSchema = zod.object({
  apiVersion: zod.literal("v1alpha1"),
  kind: zod.literal("HomelabAppsConfig"),
  apps: zod.array(appConfigSchema),
});

export type AppsConfig = zod.infer<typeof appsConfigSchema>;

export const getAppsConfig = (configDir: string) =>
  loadYaml(appsConfigSchema, join(configDir, "apps.yaml"));

const fluxConfigSchema = zod.object({
  apiVersion: zod.literal("v1alpha1"),
  kind: zod.literal("HomelabFluxConfig"),
  branch: zod.string().optional(),
  repo: zod.string(),
});

export type FluxConfig = zod.infer<typeof fluxConfigSchema>;

export const getFluxConfig = (configDir: string) =>
  loadYaml(fluxConfigSchema, join(configDir, "flux.yaml"));

const networkOutputSchema = zod.object({
  file: zod.string(),
  template: zod.string(),
  inputs: zod.record(zod.string(), zod.any()).optional().default({}),
});

const networkConfigSchema = zod.object({
  apiVersion: zod.literal("v1alpha1"),
  kind: zod.literal("HomelabNetworkConfig"),
  outputs: zod.array(networkOutputSchema),
});

export const getNetworkConfig = async (configDir: string) => {
  const secrets = await loadYaml(
    networkSecretsSchema,
    getSecretsPath("network", configDir),
  );
  const raw = (await readFile(join(configDir, "network.yaml"))).toString();
  return networkConfigSchema.parseAsync(
    parse(renderTemplate(raw, { secrets })),
  );
};

const storageConfigSchema = zod.object({
  apiVersion: zod.literal("v1alpha1"),
  kind: zod.literal("HomelabStorageConfig"),
  bucket: zod.string(),
  privateKeyItemId: zod.string(),
  publicKey: zod.string(),
});

export type StorageConfig = zod.infer<typeof storageConfigSchema>;

export const getStorageConfig = (configDir: string) =>
  loadYaml(storageConfigSchema, join(configDir, "storage.yaml"));

const appsSecretsSchema = zod.object({
  secrets: zod.record(zod.string(), zod.record(zod.string(), zod.string())),
  roles: zod.record(
    zod.string(),
    zod.object({
      namespace: zod.string(),
      ["service-account"]: zod.string(),
      secret: zod.string().optional(),
      policies: zod.boolean().optional(),
      roles: zod.boolean().optional(),
    }),
  ),
});

export type AppsSecrets = zod.infer<typeof appsSecretsSchema>;

export const getAppsSecrets = (configDir: string) =>
  loadYaml(appsSecretsSchema, getSecretsPath("apps", configDir));

const fluxSecretsSchema = zod.object({
  token: zod.string(),
});

export type FluxSecrets = zod.infer<typeof fluxSecretsSchema>;

export const getFluxSecrets = (configDir: string) =>
  loadYaml(fluxSecretsSchema, getSecretsPath("flux", configDir));

const keyPairSchema = zod.object({
  public: zod.string(),
  private: zod.string(),
});

const networkSecretsSchema = zod.object({
  router: zod.object({
    users: zod.record(zod.string(), zod.string()),
  }),
  wifi: zod.record(zod.string(), zod.string()),
  wireguard: zod.object({
    interfaces: zod.record(zod.string(), keyPairSchema),
    devices: zod.record(zod.string(), zod.record(zod.string(), keyPairSchema)),
  }),
});

export const getNetworkSecrets = (configDir: string) =>
  loadYaml(networkSecretsSchema, getSecretsPath("network", configDir));

const storageSecretsSchema = zod.object({
  privateKey: zod.string(),
});

export const getStorageSecrets = (configDir: string) =>
  loadYaml(storageSecretsSchema, getSecretsPath("storage", configDir));

const vaultSecretsSchema = zod.object({
  rootToken: zod.string(),
  unsealKey: zod.string(),
});

export type VaultSecrets = zod.infer<typeof vaultSecretsSchema>;

export const getVaultSecrets = (configDir: string) =>
  loadYaml(vaultSecretsSchema, getSecretsPath("vault", configDir));

export const secrets = [
  "apps",
  "flux",
  "network",
  "storage",
  "vault",
  "talos",
] as const;
export type Secret = (typeof secrets)[number];

export const isSecret = (v: any): v is Secret => {
  return secrets.indexOf(v) !== -1;
};

export const getSecretsPath = (secret: Secret, configDir: string) => {
  const file = `secrets-${secret}.yaml`;
  return join(configDir, file);
};
