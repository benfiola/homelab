import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    {
      repo: "https://kubernetes-sigs.github.io/metrics-server/",
      chart: "metrics-server",
      version: "3.13.0",
    },
    dir
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);
};
