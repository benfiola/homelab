import { writeFile } from "fs/promises";
import { join } from "path";
import { TemplateAssetFn } from "../../context";
import { kustomize } from "../../kubernetes";

export const assets: TemplateAssetFn = async (dir: string) => {
  const version = "8.4.0";
  const manifestUrl = `https://github.com/kubernetes-csi/external-snapshotter/deploy/kubernetes/snapshot-controller?ref=v${version}`;

  const manifest = await kustomize({
    dynamic: {
      resources: [manifestUrl],
      images: [
        {
          name: "registry.k8s.io/sig-storage/snapshot-controller",
          newTag: `v${version}`,
        },
      ],
    },
  });

  const manifestPath = join(dir, "manifest.yaml");
  await writeFile(manifestPath, manifest);
};
