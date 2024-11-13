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

const appData = {
  chart: "snapshot-controller",
  repo: "https://piraeus.io/helm-charts/",
  version: "3.0.6",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "snapshot-controller", {
    namespace: "snapshot-controller",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "snapshot-controller" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "snapshot-validation-webhook" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: { name: chart.namespace },
  });

  new Helm(chart, "helm-operator", {
    ...appData,
    namespace: chart.namespace,
    releaseName: "snapshot-controller",
    helmFlags: ["--include-crds"],
  });

  return chart;
};

export const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = await exec(getHelmTemplateCommand(appData));
  await writeFile(manifestsFile, manifest);
};

export default function async(context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
