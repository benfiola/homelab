import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { parseEnv } from "../utils/parseEnv";

const chartData = {
  crds: {
    chart: "crds",
    repo: "https://benfiola.github.io/access-operator/charts",
    version: "0.1.0-rc.7",
  },
  operator: {
    chart: "operator",
    repo: "https://benfiola.github.io/access-operator/charts",
    version: "0.1.0-rc.7",
  },
};

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    ACCESS_OPERATOR_CLOUDFLARE_TOKEN: zod.string(),
    ACCESS_OPERATOR_ROUTEROS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "access-operator", {
    namespace: "access-operator",
  });

  createNetworkPolicy(chart, [
    {
      from: { pod: "access-operator-operator" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "access-operator-server" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm-crds", {
    ...chartData.crds,
    namespace: chart.namespace,
  });

  const operatorSecret = await createSealedSecret(chart, "operator-secret", {
    metadata: { namespace: chart.namespace, name: "access-operator" },
    stringData: {
      ACCESS_OPERATOR_CLOUDFLARE_TOKEN: env.ACCESS_OPERATOR_CLOUDFLARE_TOKEN,
      ACCESS_OPERATOR_ROUTEROS_ADDRESS: "router.bulia:8728",
      ACCESS_OPERATOR_ROUTEROS_PASSWORD: env.ACCESS_OPERATOR_ROUTEROS_PASSWORD,
      ACCESS_OPERATOR_ROUTEROS_USERNAME: "access-operator",
    },
  });

  new Helm(chart, "helm-operator", {
    ...chartData.operator,
    namespace: chart.namespace,
    values: {
      // give all resources a static prefix
      fullnameOverride: "access-operator",
      operator: {
        // use external secret for configuration
        externalSecret: operatorSecret.name,
      },
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(chartData.crds));
  await writeFile(manifestFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}