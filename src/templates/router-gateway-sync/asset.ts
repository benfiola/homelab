import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";
import { homelabHelper } from "../../homelab-helper.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    homelabHelper.chart("router-gateway-sync"),
    dir,
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);
};
