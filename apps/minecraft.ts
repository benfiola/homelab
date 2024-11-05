import { Chart } from "cdk8s";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createServiceAccount } from "../utils/createServiceAccount";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    MINECRAFT_ACCESS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "minecraft", {
    namespace: "minecraft",
  });

  createNetworkPolicy(chart, [
    {
      from: { pod: "minecraft" },
      to: { dns: "*.mojang.com", ports: [[443, "tcp"]] },
    },

    {
      from: { homeNetwork: null },
      to: { pod: "minecraft", ports: [[25565, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const serviceAccount = createServiceAccount(chart, {
    access: {},
    name: "minecraft",
    namespace: chart.namespace,
  });

  const deployment = await createDeployment(chart, {
    containers: [
      {
        image: "itzg/minecraft-server:java21",
        name: "minecraft",
        env: {
          EULA: "TRUE",
          MAX_MEMORY: "6G",
          USE_AIKAR_FLAGS: "true",
        },
        ports: { udp: [25565, "udp"] },
        resources: {
          mem: 6000,
        },
        user: 1000,
      },
    ],
    name: "minecraft",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
  });

  new Service(chart, "minecraft-service", {
    metadata: {
      namespace: chart.namespace,
      name: "minecraft",
      annotations: {
        "external-dns.alpha.kubernetes.io/hostname": "minecraft.bulia",
      },
    },
    spec: {
      type: "LoadBalancer",
      ports: [{ port: 25565 }],
      selector: getPodLabels(deployment.name),
    },
  });

  //   const accessSecret = await createSealedSecret(chart, "access-secret", {
  //     metadata: { namespace: chart.namespace, name: "minecraft" },
  //     stringData: {
  //       password: env.MINECRAFT_ACCESS_PASSWORD,
  //     },
  //   });

  //   new AccessClaim(chart, "access", {
  //     metadata: {
  //       namespace: chart.namespace,
  //       name: "minecraft",
  //     },
  //     spec: {
  //       dns: "minecraft.bfiola.dev",
  //       passwordRef: {
  //         key: "password",
  //         name: accessSecret.name,
  //       },
  //       serviceTemplates: [
  //         {
  //           ports: [{ port: 25565 }],
  //         },
  //       ],
  //       ttl: "168h",
  //     },
  //   });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
