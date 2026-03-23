import { Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getAssetsServerUrl,
  getSecurityContext,
  HttpRoute,
  Namespace,
  TcpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { gameServerImage } from "../../game-server-images";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

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

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "single-player-tarkov",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": id,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": id,
          },
        },
        spec: {
          containers: [
            {
              name: "single-player-tarkov",
              image: gameServerImage("single-player-tarkov"),
              ports: [
                {
                  name: "game",
                  containerPort: 6969,
                },
                {
                  name: "raid-rev-sock",
                  containerPort: 7828,
                },
                {
                  name: "raid-rev-web",
                  containerPort: 7829,
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [{ name: "cache", mountPath: "/cache" }],
              env: [
                {
                  name: "CONFIG_PATCHES",
                  value: JSON.stringify(configPatches),
                },
                {
                  name: "MOD_URLS",
                  value: mods.join(","),
                },
                { name: "LOG_LEVEL", value: "debug" },
                { name: "VERSION", value: "4.0.13" },
              ],
            },
          ],
          securityContext: securityContext.pod,
        },
      },
      volumeClaimTemplates: [
        {
          metadata: {
            name: "cache",
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: "10Gi",
              },
            },
            storageClassName: "replicated",
          },
        } as any,
      ],
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "single-player-tarkov",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": id,
      },
      ports: [
        {
          port: 6969,
          name: "game",
        },
        {
          port: 7828,
          name: "raid-rev-sock",
        },
        {
          port: 7829,
          name: "raid-rev-web",
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "spt.bulia.dev", 6969, service, 6969);
  new TcpRoute(chart, "trusted", "spt.bulia.dev", 7828, service, 7828);
  new HttpRoute(chart, "trusted", "raid-review.spt.bulia.dev").match(
    service,
    7829,
  );

  return chart;
};
