import { Chart, Helm, Include } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
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
  operatorExt: {
    version: "2.1.0-rc.1",
  },
};

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    MINIO_TENANT_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "minio", { namespace: "minio" });

  createNetworkPolicy(chart, [
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
      from: { externalPod: ["velero", "velero"] },
      to: { pod: "minio-tenant", ports: [[9000, "tcp"]] },
    },
    {
      from: { pod: "minio-operator" },
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
            servers: 4,
            // volumes are hostpath pvs - no need for several pvs per server
            volumesPerServer: 1,
            // size pvs to account for potential velero backups
            size: "100Gi",
            // constrain the amount of resources given to each server in the pool
            resources: getPodRequests({ mem: 600 }),
            // ensure persistent volumes use the deployed storage controller
            storageClassName: getStorageClassName(false),
          },
        ],
      },
    },
  });

  new Include(chart, "include-operator-ext", {
    url: `https://raw.githubusercontent.com/benfiola/minio-operator-ext/v${appData.operatorExt.version}/manifests/crds.yaml`,
  });

  const operatorExtServiceAccount = createServiceAccount(chart, {
    namespace: chart.namespace,
    name: "minio-operator-ext",
    access: {
      "minio.min.io/tenants": ["get", "watch", "list", "patch"],
      configmaps: ["get"],
      secrets: ["get"],
      services: ["get"],
      "bfiola.dev/miniousers": ["get", "watch", "list", "update"],
      "bfiola.dev/miniobuckets": ["get", "watch", "list", "update"],
      "bfiola.dev/miniogroups": ["get", "watch", "list", "update"],
      "bfiola.dev/miniogroupbindings": ["get", "watch", "list", "update"],
      "bfiola.dev/miniopolicies": ["get", "watch", "list", "update"],
      "bfiola.dev/miniopolicybindings": ["get", "watch", "list", "update"],
    },
  });

  createDeployment(chart, {
    namespace: chart.namespace,
    name: "minio-operator-ext",
    containers: [
      {
        name: "operator",
        image: `docker.io/benfiola/minio-operator-ext:${appData.operatorExt.version}`,
        probe: ["/healthz", 8888],
        resources: { mem: 200 },
        env: { USER: "1001" },
      },
    ],
    serviceAccount: operatorExtServiceAccount.name,
  });
  return chart;
};

const resources: ResourcesCallback = async (manifestsFile) => {
  const crdsUrl = `https://raw.githubusercontent.com/benfiola/minio-operator-ext/v${appData.operatorExt.version}/manifests/crds.yaml`;
  const manifest = [
    await exec(getHelmTemplateCommand(appData.operator)),
    await fetch(crdsUrl).then((r) => r.text()),
  ].join("\n");
  await writeFile(manifestsFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
