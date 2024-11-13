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
  chart: "trust-manager",
  repo: "https://charts.jetstack.io",
  version: "v0.10.0",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "trust-manager", { namespace: "trust-manager" });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "trust-manager" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
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
    helmFlags: ["--include-crds"],
    values: {
      app: {
        trust: {
          // configure trust-manager to only trust resources originating from cert-manager's namespace
          namespace: "cert-manager",
        },
      },
      crds: {
        // remove helm 'keep' annotation to delete crds when helm release is uninstalled
        keep: false,
      },
      // give all resources a static prefix
      nameOverride: "trust-manager",
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (path) => {
  const manifest = await exec([...getHelmTemplateCommand(appData)]);
  await writeFile(path, manifest);
};

export default function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
