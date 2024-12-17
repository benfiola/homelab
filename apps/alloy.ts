import { Chart, Helm } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";

const appData = {
  chart: "alloy",
  version: "0.10.1",
  repo: "https://grafana.github.io/helm-charts",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "alloy", {
    namespace: "alloy",
  });

  createNetworkPolicy(chart, "network-policy", []);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    values: {
      alloy: {
        // disallow reporting
        enableReporting: false,
      },
      crds: {
        // do NOT create monitoring crds
        create: false,
      },
      // give helm release a more concise name
      fullnameOverride: "alloy",
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
