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
  chart: "cert-manager",
  repo: "https://charts.jetstack.io",
  version: "v1.18.1",
};

const manifests: ManifestsCallback = async (app) => {
  const { ClusterIssuer } = await import(
    "../resources/cert-manager/cert-manager.io"
  );

  const chart = new Chart(app, "cert-manager", { namespace: "cert-manager" });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "cert-manager" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "cert-manager-cainjector" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "cert-manager-startupapicheck" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "cert-manager-webhook" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { entity: "remote-node" },
      to: { pod: "cert-manager-webhook", ports: [[10250, "tcp"]] },
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
    values: {
      crds: {
        // enable crds to be generated with the chart
        enabled: true,
        // remove helm annotations to keep the crds when the release is deleted
        keep: false,
      },
      nameOverride: "cert-manager",
      // give all resources a static prefix
      fullnameOverride: "cert-manager",
    },
  });

  new ClusterIssuer(chart, "self-signed-issuer", {
    metadata: {
      name: "root",
    },
    spec: {
      selfSigned: {},
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (path) => {
  const manifest = await exec([
    ...getHelmTemplateCommand(appData),
    "--set",
    "crds.enabled=true",
  ]);
  await writeFile(path, manifest);
};

export default function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
