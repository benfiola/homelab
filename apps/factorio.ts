import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createPersistentVolumeClaim } from "../utils/createPersistentVolumeClaim";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { createVolumeBackupConfig } from "../utils/createVolumeBackupConfig";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    FACTORIO_ACCESS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "factorio", {
    namespace: "factorio",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "factorio" },
      to: {
        dns: "*.factorio.com",
        ports: [
          [443, "tcp"],
          [34197, "udp"],
        ],
      },
    },

    {
      from: { homeNetwork: null },
      to: {
        pod: "factorio",
        ports: [[34197, "udp"]],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "factorio",
  });

  const dataVolume = createPersistentVolumeClaim(chart, "pvc", {
    name: "factorio-data",
    size: "10Gi",
  });

  const deployment = createDeployment(chart, "deployment", {
    containers: [
      {
        env: {
          DLC_SPACE_AGE: "false",
        },
        image: "factoriotools/factorio:2.0.15",
        mounts: {
          data: "/factorio",
        },
        name: "factorio",
        ports: { udp: [34197, "udp"] },
        resources: {
          mem: 1000,
        },
      },
    ],
    name: "factorio",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
    user: 845,
    volumes: {
      data: dataVolume,
    },
  });

  await createVolumeBackupConfig(chart, { pvc: dataVolume.name, user: 845 });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "factorio",
      annotations: getDnsAnnotation("factorio.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [{ name: "udp", port: 34197 }],
      selector: getPodLabels(deployment.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "factorio" },
    stringData: {
      password: env.FACTORIO_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "factorio",
    },
    spec: {
      dns: "factorio.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [{ name: "udp", port: 34197 }],
          selector: getPodLabels(deployment.name),
        },
      ],
      ttl: "168h",
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
