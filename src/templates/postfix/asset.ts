import { rename } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";

export const assets: TemplateAssetFn = async (dir) => {
  // renovate: datasource=github-releases depName=bokysan/docker-postfix extractVersion=^v(?<version>.+)$
  const version = "5.1.0";

  const sourceChartPath = await helm.pull(
    {
      repo: "https://bokysan.github.io/docker-postfix",
      chart: "mail",
      version: `v${version}`,
    },
    dir,
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);
};
