import { rename, writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";
import { homelabHelper } from "../../homelab-helper.ts";
import { getTempy } from "../../tempy.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    homelabHelper.chart("gateway-route-sync"),
    dir,
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);

  const manifest = await helm.template({
    chart: destChartPath,
  });

  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (tempDir: string) => {
    const manifestPath = join(tempDir, "manifest.yaml");
    await writeFile(manifestPath, manifest);

    await cdk8s.importResources(manifestPath, dir);
  });
};
