import { glob, readFile } from "fs/promises";
import { join, parse as pathParse } from "path";
import { parse } from "yaml";
import * as zod from "zod";

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

export const getClusterConfig = async (configDir: string) => {
  const path = join(configDir, "cluster.yaml");
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await clusterConfigSchema.parseAsync(data);
  return config;
};

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
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await nodeConfigSchema.parseAsync({ name: node, ...data });
  return config;
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
    id: zod.string().default(() => undefined as any as string),
    flux: zod.boolean().default(true),
    options: zod.record(zod.string(), zod.any()).default({}),
    template: zod.string(),
  })
  .transform((data) => {
    data.id = data.id !== undefined ? data.id : data.template;
    return data;
  });

export type AppConfig = zod.infer<typeof appConfigSchema>;

const appsConfigSchema = zod.array(appConfigSchema);

export type AppsConfig = zod.infer<typeof appsConfigSchema>;

export const getAppsConfig = async (configDir: string) => {
  const path = join(configDir, "apps.yaml");
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await appsConfigSchema.parseAsync(data);
  return config;
};

const fluxConfigSchema = zod.object({
  branch: zod.string().optional(),
  repo: zod.string(),
});

export type FluxConfig = zod.infer<typeof fluxConfigSchema>;

export const getFluxConfig = async (configDir: string) => {
  const path = join(configDir, "flux.yaml");
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await fluxConfigSchema.parseAsync(data);
  return config;
};

const storageConfigSchema = zod.object({
  bucket: zod.string(),
});

export type StorageConfig = zod.infer<typeof storageConfigSchema>;

export const getStorageConfig = async (configDir: string) => {
  const path = join(configDir, "storage.yaml");
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await storageConfigSchema.parseAsync(data);
  return config;
};

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

export const getAppsSecrets = async (configDir: string) => {
  const path = await getSecretsPath("apps", configDir);
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await appsSecretsSchema.parseAsync(data);
  return config;
};

const fluxSecretsSchema = zod.object({
  token: zod.string(),
});

export type FluxSecrets = zod.infer<typeof fluxSecretsSchema>;

export const getFluxSecrets = async (configDir: string) => {
  const path = await getSecretsPath("flux", configDir);
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await fluxSecretsSchema.parseAsync(data);
  return config;
};

const vaultSecretsSchema = zod.object({
  rootToken: zod.string(),
  unsealKey: zod.string(),
});

export type VaultSecrets = zod.infer<typeof vaultSecretsSchema>;

export const getVaultSecrets = async (configDir: string) => {
  const path = await getSecretsPath("vault", configDir);
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await vaultSecretsSchema.parseAsync(data);
  return config;
};

export const secrets = ["apps", "flux", "vault", "talos"] as const;
export type Secret = (typeof secrets)[number];

export const isSecret = (v: any): v is Secret => {
  return secrets.indexOf(v) !== -1;
};

export const getSecretsPath = async (secret: Secret, configDir: string) => {
  const file = `secrets-${secret}.yaml`;
  return join(configDir, file);
};
