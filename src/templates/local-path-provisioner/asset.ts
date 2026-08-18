import { mkdir, rename, writeFile } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context.ts";
import { exec } from "../../exec.ts";
import * as helm from "../../helm.ts";
import { getTempy } from "../../tempy.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const version = "0.0.37";

  const archiveUrl = `https://github.com/rancher/local-path-provisioner/archive/refs/tags/v${version}.tar.gz`;

  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (tempDir) => {
    const response = await fetch(archiveUrl);
    if (!response.ok) {
      throw new Error(`request failed: ${response.url}`);
    }
    const archivePath = join(tempDir, "archive.tar.gz");
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));

    const extractDir = join(tempDir, "extracted");
    await mkdir(extractDir);
    await exec([
      "tar",
      "-xzf",
      archivePath,
      "-C",
      extractDir,
      "--strip-components=1",
    ]);

    const chartDir = join(
      extractDir,
      "deploy",
      "chart",
      "local-path-provisioner",
    );
    const sourceChartPath = await helm.pack({ chart: chartDir, version }, dir);
    const destChartPath = join(dir, "chart.tar.gz");

    await rename(sourceChartPath, destChartPath);
  });
};
