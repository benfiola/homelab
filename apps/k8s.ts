import { CliContext, ResourcesCallback } from "../utils/CliContext";
import { createTargets } from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";

const version = "1.32.0";

const namespace = "kube-system";

export const policyTargets = createTargets((b) => ({
  apiServer: b.target({
    entity: "kube-apiserver",
    ports: { api: [6443, "tcp"] },
  }),
  dns: b.target({
    endpoint: {
      "io.kubernetes.pod.namespace": namespace,
      "k8s-app": "kube-dns",
    },
    ports: {
      dns: [53, "any"],
      metrics: [9153, "tcp"],
    },
  }),
}));

const resources: ResourcesCallback = async (directory) => {
  await exec([
    "cdk8s",
    "import",
    `k8s@${version}`,
    "--no-class-prefix",
    "--language",
    "typescript",
    "--output",
    directory,
  ]);
};

export default async function (context: CliContext) {
  context.resources(resources, { shouldImport: false });
}
