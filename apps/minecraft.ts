import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { createStatefulSet } from "../utils/createStatefulSet";
import { createVolumeBackupConfig } from "../utils/createVolumeBackupConfig";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getMinioUrl } from "../utils/getMinioUrl";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const namespace = "minecraft";

const policyTargets = createTargets((b) => ({
  server: b.pod(namespace, "minecraft", { game: [25565, "any"] }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: minioTargets } = await import("./minio");

  const env = parseEnv((zod) => ({
    MINECRAFT_ACCESS_PASSWORD: zod.string(),
    MINECRAFT_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const mt = minioTargets;
    const homeNetwork = b.target({ cidr: "192.168.0.0/16" });
    const mojang = b.target({
      dns: "*.mojang.com",
      ports: { api: [443, "tcp"] },
    });
    const googleApis = b.target({
      dns: "*.googleapis.com",
      ports: { api: [443, "tcp"] },
    });
    const fabric = b.target({
      dns: "*.fabricmc.net",
      ports: { api: [443, "tcp"] },
    });

    b.rule(homeNetwork, pt.server, "game");
    b.rule(pt.server, fabric, "api");
    b.rule(pt.server, googleApis, "api");
    b.rule(pt.server, mt.tenant, "api");
    b.rule(pt.server, mojang, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const minioUser = await createMinioUser(
    chart,
    "minecraft",
    env.MINECRAFT_MINIO_SECRET_KEY
  );
  const minioBucket = createMinioBucket(chart, "minecraft");
  const minioPolicy = createMinioBucketAdminPolicy(chart, minioBucket.name);
  createMinioPolicyBinding(chart, minioPolicy.name, minioUser.name);

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "minecraft",
  });

  const minecraftVersion = "1.21.1";
  const mods = [
    `DistantHorizons-2.3.0-b-dev-${minecraftVersion}-fabric-neoforge.jar`,
    `tectonic-fabric-${minecraftVersion}-2.4.1a.jar`,
    `fabric-api-0.109.0+${minecraftVersion}.jar`,
  ];
  const downloadCommand = mods
    .map((m) => {
      const url = getMinioUrl(`${minioBucket.name}/${m}`);
      return `curl -o /minecraft/mods/${m} -fsSL ${url}`;
    })
    .join("\n");
  const statefulSet = createStatefulSet(chart, "deployment", {
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
            ${downloadCommand}
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
          MAX_MEMORY: "16G",
          TYPE: "FABRIC",
          USE_AIKAR_FLAGS: "true",
          VERSION: minecraftVersion,
        },
        mounts: {
          data: "/data",
        },
        ports: { tcp: [25565, "tcp"] },
        resources: {
          cpu: 2500,
          mem: 12000,
        },
      },
    ],
    name: "minecraft",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    volumeClaimTemplates: {
      data: "10Gi",
    },
    user: 1000,
  });

  await createVolumeBackupConfig(chart, {
    pvc: "data-minecraft-0",
    user: 1000,
  });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "minecraft",
      annotations: getDnsAnnotation("minecraft.bulia.dev"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [{ port: 25565 }],
      selector: getPodLabels(statefulSet.name),
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
          selector: getPodLabels(statefulSet.name),
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
