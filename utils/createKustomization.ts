import { Include } from "cdk8s";
import { Construct } from "constructs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { exec } from "./exec";
import { temporaryDirectory } from "./temporaryDirectory";

interface KustomizationPathProps {
  path: string;
}

const isKustomizationPathProps = (v: any): v is KustomizationPathProps => {
  return v["path"] !== undefined;
};

interface DynamicKustomizationProps {
  resources?: string[];
  namespace?: string;
}

type KustomizationProps = KustomizationPathProps | DynamicKustomizationProps;

export const createKustomization = async (
  construct: Construct,
  id: string,
  props: KustomizationProps
) => {
  return await temporaryDirectory(async (dir) => {
    let kustomization: string;
    if (isKustomizationPathProps(props)) {
      kustomization = props.path;
    } else {
      kustomization = join(dir, "kustomization");
      await mkdir(kustomization);
      const kustomizationFile = join(kustomization, "kustomization.yaml");
      await writeFile(kustomizationFile, JSON.stringify(props));
    }
    const content = await exec(["kustomize", "build", kustomization]);
    const url = join(dir, "manifest.yaml");
    await writeFile(url, content);
    return new Include(construct, id, { url });
  });
};
