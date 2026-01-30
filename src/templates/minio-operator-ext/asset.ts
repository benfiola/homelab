import { rename, writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm";
import { getTempy } from "../../tempy";

export const assets: TemplateAssetFn = async (dir) => {
  const version = "3.3.0";

  const sourceCrdsChartPath = await helm.pull(
    {
      repo: "https://benfiola.github.io/minio-operator-ext/charts",
      chart: "crds",
      version,
    },
    dir
  );
  const destCrdsChartPath = join(dir, "chart-crds.tar.gz");
  await rename(sourceCrdsChartPath, destCrdsChartPath);

  const sourceOperatorChartPath = await helm.pull(
    {
      repo: "https://benfiola.github.io/minio-operator-ext/charts",
      chart: "operator",
      version,
    },
    dir
  );
  const destOperatorChartPath = join(dir, "chart-operator.tar.gz");
  await rename(sourceOperatorChartPath, destOperatorChartPath);

  const crdsManifest = await helm.template({
    chart: destCrdsChartPath,
  });

  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (tempDir: string) => {
    const manifestPath = join(tempDir, "manifest.yaml");
    await writeFile(manifestPath, crdsManifest);

    await cdk8s.importResources(manifestPath, dir);
  });
};
