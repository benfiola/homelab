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
import { createSealedSecret } from "../utils/createSealedSecret";
import { exec } from "../utils/exec";
import { getCertIssuerAnnotations } from "../utils/getCertIssuerAnnotation";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodRequests } from "../utils/getPodRequests";
import { getStorageClassName } from "../utils/getStorageClassName";
import { parseEnv } from "../utils/parseEnv";

const helmData = {
  operator: {
    chart: "operator",
    repo: "https://operator.min.io",
    version: "5.0.18",
  },
  tenant: {
    chart: "tenant",
    repo: "https://operator.min.io",
    version: "5.0.18",
  },
  operatorExtCrds: {
    chart: "crds",
    repo: "http://benfiola.github.io/minio-operator-ext/charts",
    version: "3.1.0",
  },
  operatorExt: {
    chart: "operator",
    repo: "http://benfiola.github.io/minio-operator-ext/charts",
    version: "3.1.0",
  },
};

const namespace = "minio";

export const policyTargets = createTargets((b) => ({
  operator: b.pod(namespace, "minio-operator"),
  operatorExt: b.pod(namespace, "minio-operator-ext"),
  tenant: b.pod(namespace, "minio-tenant", {
    api: [9000, "tcp"],
    console: [9090, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");

  const env = parseEnv((zod) => ({
    MINIO_TENANT_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const ingress = b.target({ entity: "ingress", ports: {} });

    b.rule(ingress, pt.tenant, "api", "console");
    b.rule(pt.operator, pt.tenant, "api");
    b.rule(pt.operator, kt.apiServer, "api");
    b.rule(pt.operatorExt, pt.tenant, "api");
    b.rule(pt.operatorExt, kt.apiServer, "api");
    b.rule(pt.tenant, pt.tenant, "api");
    b.rule(pt.tenant, kt.apiServer, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: { name: chart.namespace },
  });

  new Helm(chart, "helm-operator", {
    ...helmData.operator,
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
    ...helmData.tenant,
    namespace: chart.namespace,
    values: {
      ingress: {
        api: {
          // enable ingress to the minio tenant's api (for other application access)
          annotations: getCertIssuerAnnotations(),
          enabled: true,
          host: "minio.bulia.dev",
          ingressClassName: getIngressClassName(),
          tls: [{ hosts: ["minio.bulia.dev"], secretName: "minio-tls" }],
        },
        console: {
          // enable ingress to the minio tenant's console (presents a nice ui to interact with this minio server)
          annotations: getCertIssuerAnnotations(),
          enabled: true,
          host: "console.minio.bulia.dev",
          ingressClassName: getIngressClassName(),
          tls: [
            {
              hosts: ["console.minio.bulia.dev"],
              secretName: "minio-console-tls",
            },
          ],
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
    ...helmData.operatorExtCrds,
    namespace: chart.namespace,
    values: {},
  });

  new Helm(chart, "minio-operator-ext", {
    ...helmData.operatorExt,
    namespace: chart.namespace,
    values: {
      // give all resources a static prefix
      fullnameOverride: "minio-operator-ext",
      // define resources for workload
      resources: getPodRequests({ mem: 400 }),
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = [
    await exec(getHelmTemplateCommand(helmData.operator)),
    await exec(getHelmTemplateCommand(helmData.operatorExtCrds)),
  ].join("\n");
  await writeFile(manifestsFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
