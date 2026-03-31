import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";

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
};
