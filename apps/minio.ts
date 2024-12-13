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
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodRequests } from "../utils/getPodRequests";
import { getStorageClassName } from "../utils/getStorageClassName";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  operator: {
    chart: "operator",
    repo: "https://operator.min.io",
    version: "5.0.15",
  },
  tenant: {
    chart: "tenant",
    repo: "https://operator.min.io",
    version: "5.0.15",
  },
  operatorExtCrds: {
    chart: "crds",
    repo: "http://benfiola.github.io/minio-operator-ext/charts",
    version: "2.2.0",
  },
  operatorExt: {
    chart: "operator",
    repo: "http://benfiola.github.io/minio-operator-ext/charts",
    version: "2.2.2",
  },
};

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    MINIO_TENANT_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "minio", { namespace: "minio" });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "minio-operator" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "minio-operator-ext" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "minio-tenant" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { entity: "ingress" },
      to: {
        pod: "minio-tenant",
        ports: [
          [9000, "tcp"],
          [9090, "tcp"],
        ],
      },
    },
    {
      from: { pod: "minio-operator" },
      to: { pod: "minio-tenant", ports: [[9000, "tcp"]] },
    },
    {
      from: { pod: "minio-operator-ext" },
      to: { pod: "minio-tenant", ports: [[9000, "tcp"]] },
    },
    {
      from: { pod: "minio-tenant" },
      to: { pod: "minio-tenant", ports: [[9000, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: { name: chart.namespace },
  });

  new Helm(chart, "helm-operator", {
    ...appData.operator,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      console: {
        // disable the operator console (only use the kubernetes api to administrate the minio operator)
        enabled: false,
      },
    },
  });

  const tenantConfig = await createSealedSecret(chart, "secret-tenant", {
    metadata: { namespace: chart.namespace, name: "minio-tenant" },
    stringData: {
      "config.env": [
        `export MINIO_ROOT_USER='admin'`,
        `export MINIO_ROOT_PASSWORD='${env.MINIO_TENANT_PASSWORD}'`,
      ].join("\n"),
    },
  });

  new Helm(chart, "helm-tenant", {
    ...appData.tenant,
    namespace: chart.namespace,
    values: {
      ingress: {
        api: {
          // enable ingress to the minio tenant's api (for other application access)
          enabled: true,
          ingressClassName: getIngressClassName(),
          host: "minio.bulia",
        },
        console: {
          // enable ingress to the minio tenant's console (presents a nice ui to interact with this minio server)
          enabled: true,
          ingressClassName: getIngressClassName(),
          host: "console.minio.bulia",
        },
      },
      // secrets is deprecated but has a default value - set to a falsy value (configure via tenants.secrets instead)
      secrets: "",
      tenant: {
        certificate: {
          // set to false to force http (instead of default https)
          requestAutoCert: false,
        },
        configuration: {
          // use an external secret to configure environment variables for the minio tenant
          name: tenantConfig.name,
        },
        configSecret: {
          // do not auto-generate username/passwords (instead use data in the existing secret)
          existingSecret: true,
        },
        // default is myminio - use the project name instead
        name: "minio-tenant",
        pools: [
          {
            // set labels for minio tenant
            labels: {
              "bfiola.dev/pod-name": "minio-tenant",
            },
            // provide a default name for the pool
            name: "pool",
            // create a HA minio setup
            servers: 3,
            // no need for several pvs per server
            volumesPerServer: 2,
            // size pvs to account for potential velero backups
            size: "10Gi",
            // constrain the amount of resources given to each server in the pool
            resources: getPodRequests({ mem: 2000 }),
            // ensure persistent volumes use the deployed storage controller
            storageClassName: getStorageClassName(),
          },
        ],
      },
    },
  });

  new Helm(chart, "minio-operator-ext-crds", {
    ...appData.operatorExtCrds,
    namespace: chart.namespace,
    values: {},
  });

  new Helm(chart, "minio-operator-ext", {
    ...appData.operatorExt,
    namespace: chart.namespace,
    values: {
      // give all resources a static prefix
      fullnameOverride: "minio-operator-ext",
      // define resources for workload
      resources: getPodRequests({ mem: 300 }),
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = [
    await exec(getHelmTemplateCommand(appData.operator)),
    await exec(getHelmTemplateCommand(appData.operatorExtCrds)),
  ].join("\n");
  await writeFile(manifestsFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
