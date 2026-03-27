import { rename, writeFile } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";
import { kustomize } from "../../kubernetes.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    {
      chart: "oci://registry.k8s.io/nfd/charts/node-feature-discovery",
      version: "0.18.3",
    },
    dir,
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);

  const version = "0.35.0";
  const nodeFeatureRulesManifest = `https://github.com/intel/intel-device-plugins-for-kubernetes/deployments/nfd/overlays/node-feature-rules?ref=v${version}`;
  const manifest = await kustomize({
    dynamic: {
      resources: [nodeFeatureRulesManifest],
    },
  });
  const manifestPath = join(dir, "node-feature-rules.yaml");
  await writeFile(manifestPath, manifest);
};
