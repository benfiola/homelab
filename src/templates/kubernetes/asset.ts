import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";

export const assets: TemplateAssetFn = async (dir) => {
  await cdk8s.importK8s("1.34.0", dir);
};
