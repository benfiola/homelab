import { rename, writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm";
import { getTempy } from "../../tempy";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    {
      repo: "https://backube.github.io/helm-charts",
      chart: "volsync",
      version: "0.14.0",
    },
    dir
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);

  const manifest = await helm.template({
    chart: destChartPath,
    helmFlags: ["--include-crds"],
  });

  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (tempDir: string) => {
    const manifestPath = join(tempDir, "manifest.yaml");
    await writeFile(manifestPath, manifest);

    await cdk8s.importResources(manifestPath, dir);
  });
};
