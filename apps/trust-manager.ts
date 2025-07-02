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
  chart: "trust-manager",
  repo: "https://charts.jetstack.io",
  version: "v0.18.0",
};

const namespace = "trust-manager";

const policyTargets = createTargets((b) => ({
  controller: b.pod(namespace, "trust-manager"),
}));

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "trust-manager", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const st = specialTargets;

    b.rule(pt.controller, st.kubeApiserver, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
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
  const manifest = await exec([...getHelmTemplateCommand(helmData)]);
  await writeFile(path, manifest);
};

export default function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
