import { rename, writeFile } from "fs/promises";
import { join } from "path";
import * as zod from "zod";
import * as cdk8s from "../../cdk8s-cli.ts";
import { TemplateAssetFn } from "../../context.ts";
import * as helm from "../../helm.ts";
import { kustomize } from "../../kubernetes.ts";

const githubContentSchema = zod.object({
  download_url: zod.string().nullable(),
  url: zod.string(),
  type: zod.union([zod.literal("dir"), zod.literal("file")]),
});

const fetchGithubContent = async (url: string) => {
  let response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${response.url}`);
  }
  const data = await response.json();
  return zod.array(githubContentSchema).parseAsync(data);
};

const getCrdUrls = async (version: string) => {
  const folderUrls: string[] = [
    `https://api.github.com/repos/cilium/cilium/contents/pkg/k8s/apis/cilium.io/client/crds?ref=v${version}`,
  ];

  const crdUrls: string[] = [];
  while (folderUrls.length > 0) {
    const folderUrl = folderUrls.pop()!;
    const content = await fetchGithubContent(folderUrl);
    for (const item of content) {
      if (item.type === "dir") {
        folderUrls.push(item.url);
        continue;
      }
      if (!item.download_url) {
        continue;
      }
      crdUrls.push(item.download_url);
    }
  }

  crdUrls.sort();

  return crdUrls;
};

export const assets: TemplateAssetFn = async (dir) => {
  const version = "1.18.5";

  const sourceChartPath = await helm.pull(
    {
      repo: "https://helm.cilium.io/",
      chart: "cilium",
      version,
    },
    dir
  );
  const destChartPath = join(dir, "chart.tar.gz");
  await rename(sourceChartPath, destChartPath);

  const crds = await getCrdUrls(version);
  const manifest = await kustomize({
    dynamic: {
      resources: crds,
    },
  });
  const destCrdsPath = join(dir, "crds.yaml");
  await writeFile(destCrdsPath, manifest);

  await cdk8s.importResources(destCrdsPath, dir);
};
