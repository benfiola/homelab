import { Chart, Helm, Include } from "cdk8s";
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
import { getIntelGpuNodeLabels } from "../utils/getIntelGpuNodeLabel";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const version = "0.32.1";

const appData = {
  helm: {
    chart: "intel-device-plugins-operator",
    repo: "https://intel.github.io/helm-charts/",
    version,
  },
  nodeFeatureRulesUrl: `https://raw.githubusercontent.com/intel/intel-device-plugins-for-kubernetes/refs/tags/v${version}/deployments/nfd/overlays/node-feature-rules/node-feature-rules.yaml`,
};

const namespace = "intel-device-plugins";

const policyTargets = createTargets((b) => ({
  controllerManager: b.pod(namespace, "inteldeviceplugins-controller-manager", {
    webhook: [9443, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { GpuDevicePlugin } = await import(
    "../resources/intel-device-plugins/deviceplugin.intel.com"
  );
  const { policyTargets: kubeTargets } = await import("./k8s");

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const remoteNode = b.target({ entity: "remote-node", ports: {} });

    b.rule(pt.controllerManager, kt.apiServer, "api");
    b.rule(remoteNode, pt.controllerManager, "webhook");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: getPrivilegedNamespaceLabels(),
    },
  });

  new Include(chart, "node-feature-rules", {
    url: appData.nodeFeatureRulesUrl,
  });

  new Helm(chart, "helm", {
    ...appData.helm,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      fullnameOverride: "device-plugin-operator",
    },
  });

  new GpuDevicePlugin(chart, "plugin", {
    metadata: { name: "default" },
    spec: {
      nodeSelector: getIntelGpuNodeLabels(),
      sharedDevNum: 10,
      image: `intel/intel-gpu-plugin:${version}`,
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (path) => {
  const manifest = await exec([...getHelmTemplateCommand(appData.helm)]);
  await writeFile(path, manifest);
};

export default function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
