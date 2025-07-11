import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
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

const namespace = "escape-from-tarkov";

const policyTargets = createTargets((b) => ({
  server: b.pod(namespace, "escape-from-tarkov", {
    spt: [6969, "tcp"],
    chisel: [8080, "tcp"],
    fika: [26969, "udp"],
    raidReview: [7828, 7829, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: minioTargets } = await import("./minio");

  const env = parseEnv((zod) => ({
    ESCAPE_FROM_TARKOV_MINIO_SECRET_KEY: zod.string(),
    ESCAPE_FROM_TARKOV_ACCESS_PASSWORD: zod.string(),
  }));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const mt = minioTargets;
    const github = b.target({
      dns: "github.com",
      ports: { api: [443, "tcp"] },
    });
    const githubObjects = b.target({
      dns: "*.githubusercontent.com",
      ports: { api: [443, "tcp"] },
    });
    const npm = b.target({
      dns: "registry.npmjs.org",
      ports: { api: [443, "tcp"] },
    });
    const homeNetwork = b.target({ cidr: "192.168.0.0/16" });
    const sptLfs = b.target({
      dns: "lfs.sp-tarkov.com",
      ports: { api: [443, "tcp"] },
    });

    b.rule(homeNetwork, pt.server, "chisel", "fika", "spt", "raidReview");
    b.rule(pt.server, github, "api");
    b.rule(pt.server, githubObjects, "api");
    b.rule(pt.server, mt.tenant, "api");
    b.rule(pt.server, npm, "api");
    b.rule(pt.server, sptLfs, "api");
  });

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

  const configPatches = {
    "SPT_Data/Server/configs/insurance.json": [
      { op: "replace", path: "/runIntervalSeconds", value: 60 },
    ],
    "SPT_Data/Server/database/globals.json": [
      { op: "replace", path: "/config/SavagePlayCooldown", value: 1 },
      { op: "replace", path: "/config/SavagePlayCooldownNdaFree", value: 1 },
    ],
    "SPT_Data/Server/database/traders/54cb57776803fa99248b456e/base.json": [
      { op: "replace", path: "/insurance/min_return_hour", value: 0 },
      { op: "replace", path: "/insurance/max_return_hour", value: 0 },
    ],
    "SPT_Data/Server/database/traders/54cb50c76803fa8b248b4571/base.json": [
      { op: "replace", path: "/insurance/min_return_hour", value: 0 },
      { op: "replace", path: "/insurance/max_return_hour", value: 0 },
    ],
  };
  const mods = [
    "acids-progressive-bot-system-1.6.0.zip",
    "big-brain-1.2.0.7z",
    "borkel-blood-particles-1.2.4.zip",
    "dynamic-maps-0.5.2.zip",
    "fika-plugin-1.1.4.0.zip",
    "fika-server-2.3.6.zip",
    "hands-are-not-busy-1.4.zip",
    "headshot-darkness-1.2.1.zip",
    "hollywood-fx-1.3.3.zip",
    "item-info-4.3.0.zip",
    "item-sell-price-1.5.0.zip",
    "looting-bots-1.4.1.zip",
    "modsync-0.10.2.zip",
    "please-just-fight-1.0.3.7z",
    "questing-bots-0.9.0.zip",
    "quicksell-2.0.1.zip",
    "raid-review-0.3.0.zip",
    "remove-time-gate-from-quests-1.0.3.7z",
    "sain-3.2.1.7z",
    "softcore-3.2.0.zip",
    "stash-search-1.4.0.7z",
    "stat-track-1.1.0.zip",
    "swag-donuts-4.0.0.7z",
    "thats-lit-1.3100.3.zip",
    "thats-lit-sync-1.3100.3.zip",
    "ui-fixes-3.1.2.zip",
    "unity-toolkit-1.2.0.7z",
    "waypoints-1.6.2.7z",
  ];
  const dataDirs = ["user/mods/raid_review__0.3.0/data"];
  const modUrls = mods.map((m) => getMinioUrl(`${minioBucket.name}/${m}`));
  const serverSecret = await createSealedSecret(chart, "secret", {
    metadata: { namespace: chart.namespace, name: "escape-from-tarkov" },
    stringData: {
      CACHE_ENABLED: "true",
      CACHE_FILE_SIZE_LIMIT: "1500",
      CONFIG_PATCHES: JSON.stringify(configPatches),
      DATA_DIRS: dataDirs.join(","),
      MOD_URLS: modUrls.join(","),
      SPT_VERSION: "3.10.5",
      SQUASHFS_NO_XATTRS: "1",
      CMD_NO_TRUNCATE_STDIO: "1",
    },
  });

  const statefulSet = createStatefulSet(chart, "deployment", {
    containers: [
      {
        envFrom: [serverSecret],
        image: "benfiola/single-player-tarkov:0.7.5-alpha.3-testing",
        mounts: {
          cache: "/cache",
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
      {
        image: "jpillora/chisel:1.10.1",
        name: "p2p-tunnel",
        args: ["server", "--reverse", "8080"],
        ports: {
          "chisel-server": [8080, "tcp"],
          "fika-p2p": [26969, "udp"],
        },
      },
    ],
    name: "escape-from-tarkov",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    user: 1000,
    volumeClaimTemplates: {
      cache: "2Gi",
      data: "1Gi",
    },
  });

  await createVolumeBackupConfig(chart, {
    pvc: "data-escape-from-tarkov-0",
    user: 1000,
  });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "escape-from-tarkov",
      annotations: getDnsAnnotation("eft.bulia.dev"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [
        { name: "spt-server", port: 6969, protocol: "TCP" },
        { name: "chisel-server", port: 8080, protocol: "TCP" },
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
        { name: "fika-p2p", port: 26969, protocol: "UDP" },
      ],
      selector: getPodLabels(statefulSet.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "escape-from-tarkov-access" },
    stringData: {
      password: env.ESCAPE_FROM_TARKOV_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "escape-from-tarkov",
    },
    spec: {
      dns: "eft.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [
            { name: "spt-server", port: 6969, protocol: "TCP" },
            {
              name: "fika-p2p",
              port: 26969,
              targetPort: { value: 26969 } as any,
              protocol: "UDP",
            },
          ],
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
