import { TemplateAssetFn } from "../../context.ts";
import * as jsonnet from "../../jsonnet.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const version = "1.4.2";
  const spec = `github.com/kubernetes-monitoring/kubernetes-mixin@version-${version}`;
  await jsonnet.install({ dir, vendorDir: "./jsonnet" }, spec);
};
