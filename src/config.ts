import { glob, readFile } from "fs/promises";
import { join, parse as pathParse } from "path";
import { parse } from "yaml";
import * as zod from "zod";
import { renderTemplate } from "./strings";

const loadYaml = async <T>(schema: zod.ZodType<T>, path: string): Promise<T> => {
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
  baseTalosConfig: zod.record(zod.any(), zod.any()),
  endpoint: zod.string(),
  hardware: zod.record(hardwareNameSchema, hardwareConfigSchema),
  kubernetes: zod.string(),
  name: zod.string(),
});

export type ClusterConfig = zod.infer<typeof clusterConfigSchema>;

export const getClusterConfig = (configDir: string) =>
  loadYaml(clusterConfigSchema, join(configDir, "cluster.yaml"));

const roleSchema = zod.union([
  zod.literal("controlplane"),
  zod.literal("worker"),
]);

const nodeConfigSchema = zod.object({
  enabled: zod.boolean().default(true),
  hardware: hardwareNameSchema,
  hostname: zod.string(),
  name: zod.string(),
  role: roleSchema,
});

export type NodeConfig = zod.infer<typeof nodeConfigSchema>;

export const getNodeConfig = async (configDir: string, node: string) => {
  const path = join(configDir, `node-${node}.yaml`);
  const raw = (await readFile(path)).toString();
  return nodeConfigSchema.parseAsync({ name: node, ...parse(raw) });
};

export const listNodes = async (configDir: string) => {
  let nodes: string[] = [];
  for await (const file of glob(`${configDir}/node-*.yaml`)) {
    const node = pathParse(file).name.replace("node-", "");
    nodes.push(node);
  }
  return nodes;
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

const appsConfigSchema = zod.array(appConfigSchema);

export type AppsConfig = zod.infer<typeof appsConfigSchema>;

export const getAppsConfig = (configDir: string) =>
  loadYaml(appsConfigSchema, join(configDir, "apps.yaml"));

const fluxConfigSchema = zod.object({
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
  outputs: zod.array(networkOutputSchema),
});

export const getNetworkConfig = async (
  secrets: NetworkSecrets,
  configDir: string,
) => {
  const raw = (await readFile(join(configDir, "network.yaml"))).toString();
  return networkConfigSchema.parseAsync(parse(renderTemplate(raw, { secrets })));
};

const storageConfigSchema = zod.object({
  bucket: zod.string(),
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

export type AppsSecretsSchema = zod.infer<typeof appsSecretsSchema>;

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
  wifi: zod.record(zod.string(), zod.string()),
  wireguard: zod.object({
    interfaces: zod.record(zod.string(), keyPairSchema),
    devices: zod.record(zod.string(), zod.record(zod.string(), keyPairSchema)),
  }),
});

type NetworkSecrets = zod.infer<typeof networkSecretsSchema>;

export const getNetworkSecrets = (configDir: string) =>
  loadYaml(networkSecretsSchema, getSecretsPath("network", configDir));

const vaultSecretsSchema = zod.object({
  rootToken: zod.string(),
  unsealKey: zod.string(),
});

export type VaultSecrets = zod.infer<typeof vaultSecretsSchema>;

export const getVaultSecrets = (configDir: string) =>
  loadYaml(vaultSecretsSchema, getSecretsPath("vault", configDir));

export const secrets = ["apps", "flux", "network", "vault", "talos"] as const;
export type Secret = (typeof secrets)[number];

export const isSecret = (v: any): v is Secret => {
  return secrets.indexOf(v) !== -1;
};

export const getSecretsPath = (secret: Secret, configDir: string) => {
  const file = `secrets-${secret}.yaml`;
  return join(configDir, file);
};
