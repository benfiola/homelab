import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import {
  createNetworkPolicy,
  createTargets,
  specialTargets,
} from "../utils/createNetworkPolicyNew";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";

const helmData = {
  chart: "snapshot-controller",
  repo: "https://piraeus.io/helm-charts/",
  version: "4.1.0",
};

const namespace = "snapshot-controller";

const policyTargets = createTargets((b) => ({
  controller: b.pod(namespace, "snapshot-controller"),
  webhook: b.pod(namespace, "snapshot-validation-webhook"),
}));

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "snapshot-controller", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    b.rule(policyTargets.controller, specialTargets.kubeApiserver);
    b.rule(policyTargets.webhook, specialTargets.kubeApiserver);
  });

  new Namespace(chart, "namespace", {
    metadata: { name: chart.namespace },
  });

  new Helm(chart, "helm-operator", {
    ...helmData,
    namespace: chart.namespace,
    releaseName: "snapshot-controller",
    helmFlags: ["--include-crds"],
  });

  return chart;
};

export const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = await exec(getHelmTemplateCommand(helmData));
  await writeFile(manifestsFile, manifest);
};

export default function async(context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
