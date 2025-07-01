import { Chart, Helm } from "cdk8s";
import { Command } from "commander";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  BootstrapCallback,
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
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const helmData = {
  chart: "sealed-secrets",
  repo: "https://bitnami-labs.github.io/sealed-secrets",
  version: "2.17.3",
};

const namespace = "sealed-secrets";

const policyTargets = createTargets((b) => ({
  controller: b.pod(namespace, "sealed-secrets", { default: [8080, "tcp"] }),
}));

const baseValues = {
  // give all resources a static prefix
  fullnameOverride: "sealed-secrets",
  // disable automatic cert rotation (use manual cert rotation to coordinate with github workflow)
  keyrenewperiod: "0",
};

const bootstrap: BootstrapCallback = async (app) => {
  const chart = new Chart(app, "sealed-secrets", {
    namespace,
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: { ...getPrivilegedNamespaceLabels() },
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseValues,
    },
  });

  return chart;
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "sealed-secrets", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    const remoteNode = b.target({ entity: "remote-node", ports: {} });
    b.rule(policyTargets.controller, specialTargets.kubeApiserver);
    b.rule(remoteNode, policyTargets.controller);
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: {
        ...getPrivilegedNamespaceLabels(),
      },
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseValues,
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(helmData));
  await writeFile(manifestFile, manifest);
};

const getCertificate = async () => {
  console.log(
    await exec([
      "kubeseal",
      "--fetch-cert",
      "--controller-name=sealed-secrets",
      "--controller-namespace=sealed-secrets",
    ])
  );
};

export default async function (context: CliContext) {
  context.bootstrap(bootstrap);
  context.command((program: Command) => {
    program
      .command("get-certificate")
      .description("retrieve the public key used to encrypt sealed secrets")
      .action(getCertificate);
  });
  context.manifests(manifests);
  context.resources(resources);
}
