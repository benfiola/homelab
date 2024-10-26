import { Chart, Helm } from "cdk8s";
import { Namespace } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const appData = {
  chart: "localpv-provisioner",
  repo: "https://openebs.github.io/dynamic-localpv-provisioner",
  version: "4.0.0",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "dynamic-localpv-provisioner", {
    namespace: "dynamic-localpv-provisioner",
  });

  createNetworkPolicy(chart, [
    {
      from: { pod: "openebs" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      labels: {
        ...getPrivilegedNamespaceLabels(),
      },
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    values: {
      analytics: {
        // disable analytics
        enabled: false,
      },
      // prefix resources with a static name
      fullnameOverride: "openebs",
      localpv: {
        // use talos linux configured host paths
        basePath: "/var/local/dynamic-localpv-provisioner",
      },
    },
  });

  return chart;
};

export default function async(context: CliContext) {
  context.manifests(manifests);
}
