import { rename, writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";
import { getTempy } from "../../tempy.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const version = "1.6.1";

  const sourceCrdChartPath = await helm.pull(
    {
      chart: "oci://docker.io/envoyproxy/gateway-crds-helm",
      version: `v${version}`,
    },
    dir
  );
  const destCrdChartPath = join(dir, "chart-crds.tar.gz");
  await rename(sourceCrdChartPath, destCrdChartPath);

  const srcGatewayChartPath = await helm.pull(
    {
      chart: "oci://docker.io/envoyproxy/gateway-helm",
      version: `v${version}`,
    },
    dir
  );
  const destGatewayChartPath = join(dir, "chart-gateway.tar.gz");
  await rename(srcGatewayChartPath, destGatewayChartPath);

  const manifest = await helm.template({
    chart: destCrdChartPath,
    values: {
      crds: {
        envoyGateway: {
          enabled: true,
        },
      },
    },
  });

  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (tempDir: string) => {
    const manifestPath = join(tempDir, "manifest.yaml");
    await writeFile(manifestPath, manifest);

    await cdk8s.importResources(manifestPath, dir);
  });
};
