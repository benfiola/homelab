import { Include } from "cdk8s";
import { Construct } from "constructs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { exec } from "./exec";
import { temporaryDirectory } from "./temporaryDirectory";

/**
 * A path to a kustomization
 */
interface KustomizationPathProps {
  path: string;
}

/**
 * Typeguard ensuring an object is a KustomizationPathProps object
 * @param v the object
 * @returns true if the object is a KustomizationPathProps
 */
const isKustomizationPathProps = (v: any): v is KustomizationPathProps => {
  return v["path"] !== undefined;
};

/**
 * A dynamic kustomization
 */
interface DynamicKustomizationProps {
  resources?: string[];
  namespace?: string;
}

/**
 * Represents a type of kustomization props
 */
type KustomizationProps = KustomizationPathProps | DynamicKustomizationProps;

/**
 * Generates a kustomization and imports it into cdk8s
 * @param construct the construct to attach the resource to
 * @param id the resource id
 * @param props the resource properties
 * @returns the created Include resource
 */
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
