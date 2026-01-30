import { writeFile } from "fs/promises";
import { join } from "path";
import * as cdk8s from "../../cdk8s-cli.ts";
import { getTempy } from "../../tempy";
import { TemplateAssetFn } from "../../context.ts";

export const assets: TemplateAssetFn = async (dir) => {
  const version = "2.7.3";
  const manifestUrl = `https://github.com/fluxcd/flux2/releases/download/v${version}/install.yaml`;

  const manifest = await fetch(manifestUrl).then((response) => response.text());

  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (tempDir: string) => {
    const manifestPath = join(tempDir, "manifest.yaml");
    await writeFile(manifestPath, manifest);

    await cdk8s.importResources(manifestPath, dir);
  });
};
