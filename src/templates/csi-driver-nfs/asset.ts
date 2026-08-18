import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context";
import * as helm from "../../helm";

export const assets: TemplateAssetFn = async (dir: string) => {
  const sourceChartPath = await helm.pull(
    {
      repo: `https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts`,
      chart: "csi-driver-nfs",
      version: "4.13.4",
    },
    dir,
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);
};
