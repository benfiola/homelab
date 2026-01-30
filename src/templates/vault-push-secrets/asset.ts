import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm";
import { homelabHelper } from "../../homelab-helper.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const sourceChartPath = await helm.pull(
    homelabHelper.chart("vault-push-secrets"),
    dir,
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);
};
