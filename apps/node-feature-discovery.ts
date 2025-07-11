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
} from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const helmData = {
  chart: "node-feature-discovery",
  repo: "https://kubernetes-sigs.github.io/node-feature-discovery/charts",
  version: "v0.17.3",
};

const namespace = "node-feature-discovery";

const policyTargets = createTargets((b) => ({
  gc: b.pod(namespace, "node-feature-discovery-gc"),
  master: b.pod(namespace, "node-feature-discovery-master"),
  prune: b.pod(namespace, "node-feature-discovery-prune"),
  worker: b.pod(namespace, "node-feature-discovery-worker"),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;

    b.rule(pt.gc, kt.apiServer, "api");
    b.rule(pt.master, kt.apiServer, "api");
    b.rule(pt.prune, kt.apiServer, "api");
    b.rule(pt.worker, kt.apiServer, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: getPrivilegedNamespaceLabels(),
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      fullnameOverride: "node-feature-discovery",
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
