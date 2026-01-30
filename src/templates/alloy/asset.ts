import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context";
import * as helm from "../../helm";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    {
      repo: "https://grafana.github.io/helm-charts",
      chart: "alloy",
      version: "1.4.0",
    },
    dir
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);
};
