import { glob, readFile } from "fs/promises";
import { join, parse as pathParse } from "path";
import { parse } from "yaml";
import * as zod from "zod";

const hardwareNameSchema = zod.union([zod.literal("rpi4"), zod.literal("tc")]);

const diskConfigSchema = zod.object({
  device: zod.string(),
  size: zod.string().optional(),
});

const hardwareConfigSchema = zod.object({
  disks: zod.record(zod.string(), diskConfigSchema),
  image: zod.string(),
});

const clusterConfigSchema = zod.object({
  baseTalosConfig: zod.record(zod.any(), zod.any()),
  endpoint: zod.string(),
  hardware: zod.record(hardwareNameSchema, hardwareConfigSchema),
  kubernetes: zod.string(),
  name: zod.string(),
});

export type ClusterConfig = zod.infer<typeof clusterConfigSchema>;

const roleSchema = zod.union([
  zod.literal("controlplane"),
  zod.literal("worker"),
]);

const nodeConfigSchema = zod.object({
  hardware: hardwareNameSchema,
  hostname: zod.string(),
  role: roleSchema,
});

export type NodeConfig = zod.infer<typeof nodeConfigSchema>;

const configDir = join(__dirname, "..", "config");

export const getClusterConfig = async () => {
  const path = join(configDir, "cluster.yaml");
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await clusterConfigSchema.parseAsync(data);
  return config;
};

export const getNodeConfig = async (node: string) => {
  const path = join(configDir, "nodes", `${node}.yaml`);
  const dataStr = (await readFile(path)).toString();
  const data = await parse(dataStr);
  const config = await nodeConfigSchema.parseAsync(data);
  return config;
};

export const listNodes = async () => {
  const nodes: string[] = [];
  for await (const file of glob(`${configDir}/nodes/*.yaml`)) {
    const node = pathParse(file).name;
    nodes.push(node);
  }
  return nodes;
};
