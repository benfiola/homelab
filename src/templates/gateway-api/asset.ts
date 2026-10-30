import { writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";

export const assets: TemplateAssetFn = async (dir) => {
  // renovate: datasource=github-releases depName=kubernetes-sigs/gateway-api extractVersion=^v(?<version>.+)$
  const version = "1.6.3";
  const manifestUrl = `https://github.com/kubernetes-sigs/gateway-api/releases/download/v${version}/experimental-install.yaml`;

  const manifest = await fetch(manifestUrl).then((response) => response.text());

  const manifestPath = join(dir, "manifest.yaml");
  await writeFile(manifestPath, manifest);

  await cdk8s.importResources(manifestPath, dir);
};
