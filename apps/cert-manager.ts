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
  chart: "cert-manager",
  repo: "https://charts.jetstack.io",
  version: "v1.18.1",
};

const namespace = "cert-manager";

const policyTargets = createTargets((b) => ({
  caInjector: b.pod(namespace, "cert-manager-cainjector"),
  controller: b.pod(namespace, "cert-manager"),
  startupiApiCheck: b.pod(namespace, "cert-manager-startupapicheck"),
  webhook: b.pod(namespace, "cert-manager-webhook", { api: [10250, "tcp"] }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { ClusterIssuer } = await import(
    "../resources/cert-manager/cert-manager.io"
  );

  const chart = new Chart(app, "cert-manager", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const st = specialTargets;
    const remoteNode = b.target({ entity: "remote-node" });

    b.rule(pt.caInjector, st.kubeApiserver, "api");
    b.rule(pt.controller, st.kubeApiserver, "api");
    b.rule(pt.startupiApiCheck, st.kubeApiserver, "api");
    b.rule(pt.webhook, st.kubeApiserver, "api");
    b.rule(remoteNode, pt.webhook, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
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
    ...getHelmTemplateCommand(helmData),
    "--set",
    "crds.enabled=true",
  ]);
  await writeFile(path, manifest);
};

export default function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
