import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
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
    MINECRAFT_ACCESS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "minecraft", {
    namespace: "minecraft",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "minecraft" },
      to: { dns: "*.mojang.com", ports: [[443, "tcp"]] },
    },
    {
      from: { pod: "minecraft" },
      to: { dns: "*.googleapis.com", ports: [[443, "tcp"]] },
    },

    {
      from: { homeNetwork: null },
      to: { pod: "minecraft", ports: [[25565, "any"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "minecraft",
  });

  const dataVolume = createPersistentVolumeClaim(chart, "pvc", {
    name: "minecraft-data",
    size: "10Gi",
  });

  const deployment = createDeployment(chart, "deployment", {
    initContainers: [
      {
        image: "alpine/curl",
        mounts: {
          data: "/minecraft",
        },
        name: "download-dh",
        command: ["sh", "-ex", "-c"],
        args: [
          codeblock`
            mkdir -p /minecraft/mods;
            curl -o /minecraft/mods/DistantHorizons-2.3.0-b-dev-1.21.1-fabric-neoforge.jar -fsSL https://storage.googleapis.com/minecraft-vy2vra/DistantHorizons-2.3.0-b-dev-1.21.1-fabric-neoforge.jar
          `,
        ],
      },
    ],
    containers: [
      {
        image: "itzg/minecraft-server:java21",
        name: "minecraft",
        env: {
          EULA: "TRUE",
          MAX_MEMORY: "6G",
          TYPE: "FABRIC",
          USE_AIKAR_FLAGS: "true",
          VERSION: "1.20.1",
        },
        mounts: {
          data: "/data",
        },
        ports: { tcp: [25565, "tcp"] },
        resources: {
          mem: 6000,
        },
      },
    ],
    name: "minecraft",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
    volumes: {
      data: dataVolume,
    },
    user: 1000,
  });

  await createVolumeBackupConfig(chart, { pvc: dataVolume.name, user: 1000 });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "minecraft",
      annotations: getDnsAnnotation("minecraft.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [{ port: 25565 }],
      selector: getPodLabels(deployment.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "minecraft" },
    stringData: {
      password: env.MINECRAFT_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "minecraft",
    },
    spec: {
      dns: "minecraft.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [{ port: 25565 }],
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
