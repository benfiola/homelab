import {
  Chart,
  getAssetsServerUrl,
  HttpRoute,
  Namespace,
  StatefulSet,
  TcpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const mods = [
    "BackendURLRewriter-1.0.0.zip",
    "DynamicMaps-1.0.5.zip",
    "LootingBots-1.6.3.zip",
    "RaidReview-1.0.2.3.zip",
    "SAIN-4.4.0.zip",
    "ShowMeTheMoney-2.7.0.7z",
    "StatTrack-2.0.0.7z",
    "UIFixes-5.3.7.zip",
  ].map((m) => getAssetsServerUrl(`single-player-tarkov/${m}`));

  const configPatches = {
    // immediate return of insurance items
    "SPT_Data/configs/insurance.json": [
      { op: "replace", path: "/runIntervalSeconds", value: 60 },
    ],
    "SPT_Data/database/traders/54cb57776803fa99248b456e/base.json": [
      { op: "replace", path: "/insurance/min_return_hour", value: 0 },
      { op: "replace", path: "/insurance/max_return_hour", value: 0 },
    ],
    "SPT_Data/database/traders/54cb50c76803fa8b248b4571/base.json": [
      { op: "replace", path: "/insurance/min_return_hour", value: 0 },
      { op: "replace", path: "/insurance/max_return_hour", value: 0 },
    ],

    // immediate scav run cooldown
    "SPT_Data/database/globals.json": [
      { op: "replace", path: "/config/SavagePlayCooldown", value: 1 },
      { op: "replace", path: "/config/SavagePlayCooldownNdaFree", value: 1 },
    ],
  };

  const ss = new StatefulSet(chart, "single-player-tarkov", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      cache: {
        pvc: { size: "10Gi", storageClass: "standard" },
      },
      data: {
        pvc: { size: "10Gi", storageClass: "replicated" },
      },
    },
  });
  ss.addContainer(
    "single-player-tarkov",
    "ghcr.io/benfiola/homelab-images/single-player-tarkov:1.0.5",
    {
      containerPorts: {
        game: 6969,
        "raid-rev-sock": 7828,
        "raid-rev-web": 7829,
      },
      env: {
        CONFIG_PATCHES: JSON.stringify(configPatches),
        MOD_URLS: mods.join(","),
        LOG_LEVEL: "debug",
        VERSION: "4.0.13",
      },
      volumeMounts: {
        cache: "/cache",
        data: "/data",
      },
    },
  );

  const svc = ss.createService({
    game: 6969,
    "raid-rev-sock": 7828,
    "raid-rev-web": 7829,
  });

  new TcpRoute(chart, "users", "spt.bulia.dev", 6969, svc, 6969);
  new TcpRoute(chart, "users", "spt.bulia.dev", 7828, svc, 7828);
  new HttpRoute(chart, "users", "spt.bulia.dev").match(svc, 7829);

  return chart;
};
