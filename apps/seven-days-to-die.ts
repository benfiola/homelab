import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import {
  createNetworkPolicy,
  CreateNetworkPolicyRule,
} from "../utils/createNetworkPolicy";
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
    SEVEN_DAYS_TO_DIE_ACCESS_PASSWORD: zod.string(),
    SEVEN_DAYS_TO_DIE_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "seven-days-to-die", {
    namespace: "seven-days-to-die",
  });

  const udpCidrs = [
    "45.121.184.0/24",
    "103.10.124.0/24",
    "103.10.125.0/24",
    "103.28.54.0/24",
    "146.66.152.0/24",
    "146.66.155.0/24",
    "155.133.224.0/2",
    "155.133.225.0/2",
    "155.133.226.0/2",
    "155.133.227.0/2",
    "155.133.228.0/2",
    "155.133.229.0/2",
    "155.133.230.0/2",
    "155.133.232.0/2",
    "155.133.236.0/2",
    "155.133.238.0/2",
    "155.133.240.0/2",
    "155.133.244.0/2",
    "155.133.246.0/2",
    "155.133.248.0/2",
    "155.133.249.0/2",
    "155.133.250.0/2",
    "155.133.251.0/2",
    "155.133.252.0/2",
    "155.133.253.0/2",
    "155.133.254.0/2",
    "155.133.255.0/2",
    "162.254.192.0/2",
    "162.254.193.0/2",
    "162.254.195.0/2",
    "162.254.196.0/2",
    "162.254.197.0/2",
    "162.254.198.0/2",
    "162.254.199.0/2",
    "185.25.182.0/24",
    "185.25.183.0/24",
    "192.69.96.0/22",
    "205.196.6.0/24",
    "208.64.200.0/24",
    "208.64.201.0/24",
    "208.64.202.0/24",
    "208.64.203.0/24",
    "208.78.164.0/22",
  ];
  const sdtdToSteamUdpCidrsRules: CreateNetworkPolicyRule[] = udpCidrs.map(
    (cidr) => ({
      from: { pod: "seven-days-to-die" },
      to: { cidr, ports: [[[27015, 27060], "udp"]] },
    })
  );

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { homeNetwork: null },
      to: {
        pod: "seven-days-to-die",
        ports: [
          [8080, "tcp"],
          [8081, "tcp"],
          [[26900, 26903], "udp"],
          [26900, "tcp"],
        ],
      },
    },

    ...sdtdToSteamUdpCidrsRules,

    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "api.epicgames.dev",
        ports: [[443, "tcp"]],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: { dns: "*.googleapis.com", ports: [[443, "tcp"]] },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "api.steampowered.com",
        ports: [[443, "tcp"]],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "test.steampowered.com",
        ports: [[80, "tcp"]],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
      to: {
        dns: "*.steamserver.net",
        ports: [
          [80, "tcp"],
          [443, "tcp"],
          [[27015, 27060], "any"],
        ],
      },
    },
    {
      from: { pod: "seven-days-to-die" },
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
    "seven-days-to-die",
    env.SEVEN_DAYS_TO_DIE_MINIO_SECRET_KEY
  );
  const minioBucket = createMinioBucket(chart, "seven-days-to-die");
  const minioPolicy = createMinioBucketAdminPolicy(chart, minioBucket.name);
  createMinioPolicyBinding(chart, minioPolicy.name, minioUser.name);

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "seven-days-to-die",
  });

  const cacheVolume = createPersistentVolumeClaim(chart, "pvc-cache", {
    name: "seven-days-to-die-cache",
    size: "30Gi",
  });

  const dataVolume = createPersistentVolumeClaim(chart, "pvc", {
    name: "seven-days-to-die-data",
    size: "30Gi",
  });

  await createVolumeBackupConfig(chart, { pvc: dataVolume.name, user: 1000 });

  const roots = ["DF-V6-DEV-B18.zip", "df-v6-b18-broadcast-fix.zip"];
  const rootUrls = roots.map((r) => getMinioUrl(`${minioBucket.name}/${r}`));
  const serverSecret = await createSealedSecret(chart, "secret", {
    metadata: { namespace: chart.namespace, name: "seven-days-to-die" },
    stringData: {
      CACHE_ENABLED: "true",
      CACHE_SIZE_LIMIT: "26000",
      MANIFEST_ID: "6852366042385286885",
      ROOT_URLS: rootUrls.join(","),
      SETTING_DynamicMeshEnabled: "false",
      SETTING_EACEnabled: "false",
      SETTING_GameDifficulty: "2",
      SETTING_GameWorld: "DFalls-Navezgane",
      SETTING_LootRespawnDays: "3",
      SETTING_MaxSpawnedZombies: "100",
      SETTING_OptionsDynamicMusicEnabled: "false",
      SETTING_Region: "NorthAmericaWest",
      SETTING_ServerName: "seven-days-to-die.bfiola.dev",
      SETTING_ServerVisibility: "0",
      SETTING_ZombieMove: "0",
      SETTING_ZombieMoveNight: "1",
      SETTING_ZombieFeralMove: "2",
      SETTING_ZombieBMMove: "3",
    },
  });

  const deployment = createDeployment(chart, "deployment", {
    containers: [
      {
        envFrom: [serverSecret],
        image: "benfiola/seven-days-to-die:0.1.0",
        imagePullPolicy: "Always",
        mounts: {
          cache: "/cache",
          data: "/data",
        },
        name: "seven-days-to-die",
        ports: {
          dashboard: [8080, "tcp"],
          telnet: [8081, "tcp"],
          udp1: [26900, "udp"],
          tcp: [26900, "tcp"],
          udp2: [26901, "udp"],
          udp3: [26902, "udp"],
          udp4: [26903, "udp"],
        },
        resources: {
          cpu: 2000,
          mem: 16000,
        },
      },
    ],
    name: "seven-days-to-die",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
    user: 1000,
    volumes: {
      cache: cacheVolume,
      data: dataVolume,
    },
  });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "seven-days-to-die",
      annotations: getDnsAnnotation("sdtd.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [
        { name: "dashboard", port: 8080, protocol: "TCP" },
        { name: "telnet", port: 8081, protocol: "TCP" },
        { name: "udp1", port: 26900, protocol: "UDP" },
        { name: "tcp", port: 26900, protocol: "TCP" },
        { name: "udp2", port: 26901, protocol: "UDP" },
        { name: "udp3", port: 26902, protocol: "UDP" },
        { name: "udp4", port: 26903, protocol: "UDP" },
      ],
      selector: getPodLabels(deployment.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "seven-days-to-die-access" },
    stringData: {
      password: env.SEVEN_DAYS_TO_DIE_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "seven-days-to-die",
    },
    spec: {
      dns: "sdtd.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [
            { name: "udp1", port: 26900, protocol: "UDP" },
            { name: "tcp", port: 26900, protocol: "TCP" },
            { name: "udp2", port: 26901, protocol: "UDP" },
            { name: "udp3", port: 26902, protocol: "UDP" },
            { name: "udp4", port: 26903, protocol: "UDP" },
          ],
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
