import { Chart } from "cdk8s";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createPersistentVolumeClaim } from "../utils/createPersistentVolumeClaim";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { createVolumeBackupConfig } from "../utils/createVolumeBackupConfig";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getMinioUrl } from "../utils/getMinioUrl";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    ESCAPE_FROM_TARKOV_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "escape-from-tarkov", {
    namespace: "escape-from-tarkov",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { homeNetwork: null },
      to: {
        pod: "escape-from-tarkov",
        ports: [
          [6969, "tcp"],
          [7828, "tcp"],
          [7829, "tcp"],
        ],
      },
    },

    {
      from: { pod: "escape-from-tarkov" },
      to: {
        dns: "raw.githubusercontent.com",
        ports: [[443, "tcp"]],
      },
    },

    {
      from: { pod: "escape-from-tarkov" },
      to: {
        externalPod: ["minio", "minio-tenant"],
        ports: [[9000, "tcp"]],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const minioUser = await createMinioUser(
    chart,
    "escape-from-tarkov",
    env.ESCAPE_FROM_TARKOV_MINIO_SECRET_KEY
  );
  const minioBucket = createMinioBucket(chart, "escape-from-tarkov");
  const minioPolicy = createMinioBucketAdminPolicy(chart, minioBucket.name);
  createMinioPolicyBinding(chart, minioPolicy.name, minioUser.name);

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "escape-from-tarkov",
  });

  const dataVolume = createPersistentVolumeClaim(chart, "pvc", {
    name: "escape-from-tarkov-data",
    size: "1Gi",
  });

  await createVolumeBackupConfig(chart, { pvc: dataVolume.name, user: 1000 });

  const configPatches = {
    "SPT_Data/Server/configs/insurance.json": [
      { op: "replace", path: "/runIntervalSeconds", value: "60" },
    ],
    "SPT_Data/Server/database/globals.json": [
      { op: "replace", path: "/config/SavagePlayCooldown", value: "1" },
      { op: "replace", path: "/config/SavagePlayCooldownNdaFree", value: "1" },
    ],
    "SPT_Data/Server/database/traders/54cb57776803fa99248b456e/base.json": [
      { op: "replace", path: "/insurance/min_return_hour", value: "0" },
      { op: "replace", path: "/insurance/max_return_hour", value: "0" },
    ],
    "SPT_Data/Server/database/traders/54cb50c76803fa8b248b4571/base.json": [
      { op: "replace", path: "/insurance/min_return_hour", value: "0" },
      { op: "replace", path: "/insurance/max_return_hour", value: "0" },
    ],
  };
  const mods = [
    "algorithmic-level-progression-5.4.3.zip",
    "big-brain-1.2.0.7z",
    "dynamic-maps-0.5.2.zip",
    "item-info-4.3.0.zip",
    "item-sell-price-1.5.0.zip",
    "live-flea-prices-1.4.0.zip",
    "looting-bots-1.4.1.zip",
    "moar-2.6.7.zip",
    "modsync-0.10.2.zip",
    "raid-review-0.3.0.zip",
    "remove-time-gate-from-quests-1.0.3.7z",
    "sain-3.2.1.7z",
    "thats-lit-1.3100.3.zip",
    "thats-lit-sync-1.3100.3.zip",
    "ui-fixes-3.1.1.zip",
    "waypoints-1.6.1.7z",
  ];
  const modUrls = mods.map((m) => getMinioUrl(`${minioBucket.name}/${m}`));
  const serverSecret = await createSealedSecret(chart, "secret", {
    metadata: { namespace: chart.namespace, name: "escape-from-tarkov" },
    stringData: {
      CONFIG_PATCHES: JSON.stringify(configPatches),
      MOD_URLS: modUrls.join(","),
    },
  });

  const deployment = createDeployment(chart, "deployment", {
    containers: [
      {
        envFrom: [serverSecret],
        image: "benfiola/single-player-tarkov:0.4.0-spt3.10.5",
        mounts: {
          data: "/data",
        },
        name: "escape-from-tarkov",
        ports: {
          "raid-rev-ws": [7828, "tcp"],
          "raid-rev-http": [7829, "tcp"],
          "spt-server": [6969, "tcp"],
        },
        resources: {
          cpu: 2000,
          mem: 4000,
        },
      },
    ],
    name: "escape-from-tarkov",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
    user: 1000,
    volumes: {
      data: dataVolume,
    },
  });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "escape-from-tarkov",
      annotations: getDnsAnnotation("eft.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [
        { name: "spt-server", port: 6969, protocol: "TCP" },
        {
          name: "raid-rev-ws",
          port: 7828,
          protocol: "TCP",
        },
        {
          name: "raid-rev-http",
          port: 7829,
          protocol: "TCP",
        },
      ],
      selector: getPodLabels(deployment.name),
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
