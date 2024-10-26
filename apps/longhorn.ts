import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { disableDefineDefaultResources } from "../utils/defineDefaultResources";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const appData = {
  chart: "longhorn",
  repo: "https://charts.longhorn.io",
  version: "1.7.2",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "longhorn", {
    namespace: "longhorn",
  });

  createNetworkPolicy(chart, [
    {
      from: { longhorn: { app: "csi-attacher" } },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { longhorn: { app: "csi-provisioner" } },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { longhorn: { app: "csi-resizer" } },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { longhorn: { app: "csi-snapshotter" } },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "longhorn-driver-deployer" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "longhorn-manager" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "longhorn-post-upgrade" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "longhorn-uninstall" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { pod: "longhorn-manager" },
      to: {
        longhorn: { component: "instance-manager" },
        ports: [
          [8500, "tcp"],
          [8501, "tcp"],
          [8503, "tcp"],
        ],
      },
    },

    {
      from: { entity: "remote-node" },
      to: {
        pod: "longhorn-manager",
        ports: [
          [9501, "tcp"],
          [9502, "tcp"],
        ],
      },
    },
    {
      from: { longhorn: { app: "longhorn-csi-plugin" } },
      to: {
        pod: "longhorn-manager",
        ports: [[9500, "tcp"]],
      },
    },
    {
      from: { pod: "longhorn-driver-deployer" },
      to: {
        pod: "longhorn-manager",
        ports: [[9500, "tcp"]],
      },
    },
    {
      from: { pod: "longhorn-manager" },
      to: {
        pod: "longhorn-manager",
        ports: [[9501, "tcp"]],
      },
    },
    {
      from: { pod: "longhorn-ui" },
      to: {
        pod: "longhorn-manager",
        ports: [[9500, "tcp"]],
      },
    },
    {
      from: { entity: "ingress" },
      to: {
        pod: "longhorn-ui",
        ports: [[8000, "tcp"]],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: {
        ...getPrivilegedNamespaceLabels(),
      },
    },
  });

  const helm = new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      defaultSettings: {
        // use talos linux configured host paths
        defaultDataPath: "/var/local/longhorn",
      },
      ingress: {
        // expose longhorn's ui via ingress
        enabled: true,
        host: "longhorn.bulia",
        ingressClassName: getIngressClassName(),
        pathType: "Prefix",
        tls: false,
      },
      preUpgradeChecker: {
        // the helm pre-upgrade hook prevents argocd from installing the app
        jobEnabled: false,
      },
      persistence: {
        // do not set as default storage class - require manifests to explicity define storage class
        defaultClass: false,
      },
    },
  });
  // longhorn appears to be written under the assumption that no requests/limits are defined
  // requests/limits are not configurable via helm chart values *and* the defaults we set are too small
  // NOTE: https://github.com/longhorn/longhorn/issues/8332
  disableDefineDefaultResources(helm);

  return chart;
};

export const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = await exec(getHelmTemplateCommand(appData));
  await writeFile(manifestsFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
