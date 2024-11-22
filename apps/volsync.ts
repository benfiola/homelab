import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  chart: "volsync",
  repo: "https://backube.github.io/helm-charts",
  version: "0.11.0",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "volsync", { namespace: "volsync" });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "volsync" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { externalPod: ["*", "volsync-mover"] },
      to: { externalPod: ["minio", "minio-tenant"], ports: [[9000, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    releaseName: "volsync",
    helmFlags: ["--include-crds"],
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(appData));
  await writeFile(manifestFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
