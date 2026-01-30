import { writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";
import { kustomize } from "../../kubernetes";

export const assets: TemplateAssetFn = async (dir) => {
  const version = "8.4.0";

  const manifestUrl = `https://github.com/kubernetes-csi/external-snapshotter/client/config/crd?ref=v${version}`;

  const manifest = await kustomize({
    dynamic: {
      resources: [manifestUrl],
    },
  });

  const manifestPath = join(dir, "manifest.yaml");
  await writeFile(manifestPath, manifest);

  await cdk8s.importResources(manifestPath, dir);
};
