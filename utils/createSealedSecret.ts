import { App, Chart } from "cdk8s";
import { Construct } from "constructs";
import { writeFile } from "fs/promises";
import path from "path";
import { ObjectMeta, Secret, SecretProps } from "../resources/k8s/k8s";
import { SealedSecret } from "../resources/sealed-secrets/bitnami.com";
import { exec } from "./exec";
import { temporaryDirectory } from "./temporaryDirectory";

/**
 * Returns label storing checksum of data within sealed-secret
 *
 * @returns label
 */
export const getChecksumLabel = () => {
  return "bfiola.dev/checksum";
};

/**
 * Hash function taken from https://stackoverflow.com/a/52171480
 *
 * @param data string to hash
 * @param seed hash seed
 * @returns hash string
 */
export const hash = (data: string, seed: number = 0) => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < data.length; i++) {
    ch = data.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

/**
 * Produces a 'base' kubeseal command that includes repo-specific data (e.g., sealed-secrets deployed namespace/controller name)
 * @returns a partial command within a string aray
 */
const getBaseKubesealCmd = () => {
  let cmd = [
    "kubeseal",
    "--controller-name=sealed-secrets",
    "--controller-namespace=sealed-secrets",
  ];
  if (process.env["SEALED_SECRETS_CERT_PATH"]) {
    cmd = [...cmd, `--cert=${process.env["SEALED_SECRETS_CERT_PATH"]}`];
  } else if (process.env["KUBECONFIG"]) {
    cmd = [...cmd, `--kubeconfig=${process.env["KUBECONFIG"]}`];
  }

  return cmd;
};

interface CreateSealedSecretPropsMeta extends ObjectMeta {
  namespace: string | undefined;
}

interface CreateSealedSecretProps extends SecretProps {
  metadata: CreateSealedSecretPropsMeta;
}

/**
 * Creates a `SealedSecret` from standard `Secret` props.
 *
 * Additionally embeds a checksum into the `SealedSecret` to facilitate more intelligent merges into existing manifests.
 *
 * @param construct construct
 * @param id id of the generated SealedSecret
 * @param props props to encrypt and embed in a `SealedSecret`
 * @returns a `SealedSecret`
 */
export const createSealedSecret = async (
  construct: Construct,
  id: string,
  props: CreateSealedSecretProps
) => {
  return await temporaryDirectory(async (directory) => {
    // create secret manifest
    const manifestFile = path.join(directory, "manifest.yaml");
    const app = new App();
    const chart = new Chart(app, "chart");
    new Secret(chart, "secret", props);
    const manifest = app.synthYaml();

    // write manifest to file
    await writeFile(manifestFile, manifest);

    // run kubeseal using the secret manifest
    let cmd = [...getBaseKubesealCmd(), `--secret-file=${manifestFile}`];

    // parse the sealed secret
    const sealedProps = JSON.parse(await exec(cmd));

    // obtain the sealed secret cert
    // NOTE: the cert is included in the hash to ensure the checksum changes when the sealed-secret instance changes
    cmd = [...getBaseKubesealCmd(), "--fetch-cert"];
    const cert = await exec(cmd);

    // generate checksum
    const hashData = { ...props, cert };
    const checksum = `${hash(JSON.stringify(hashData))}`;

    // embed metadata
    sealedProps.metadata = {
      ...(sealedProps?.metadata || {}),
      labels: {
        ...(sealedProps?.metadata?.labels || {}),
        [getChecksumLabel()]: checksum,
      },
    };

    // create sealed secret
    const sealedSecret = new SealedSecret(construct, id, sealedProps);
    return sealedSecret;
  });
};
