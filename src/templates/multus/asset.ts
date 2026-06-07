import { writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli";

export const assets = async (dir: string) => {
  const version = "4.2.4";
  const manifestUrl = `https://raw.githubusercontent.com/k8snetworkplumbingwg/multus-cni/refs/tags/v${version}/deployments/multus-daemonset-thick.yml`;

  const manifest = await fetch(manifestUrl).then((response) => response.text());

  const manifestPath = join(dir, "manifest.yaml");
  await writeFile(manifestPath, manifest);

  await cdk8s.importResources(manifestPath, dir);
};
