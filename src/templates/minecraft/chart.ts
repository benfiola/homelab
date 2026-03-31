import {
  PersistentVolumeClaimTemplate,
  Service,
  StatefulSet,
} from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getAssetsServerUrl,
  getSecurityContext,
  Namespace,
  TcpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "minecraft",
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
              name: "minecraft",
              image: "itzg/minecraft-server:java25-jdk",
              env: [
                { name: "EULA", value: "true" },
                { name: "VERSION", value: "1.21.11" },
                {
                  name: "MODPACK",
                  value: getAssetsServerUrl("minecraft/mods.zip"),
                },
                { name: "TYPE", value: "FABRIC" },
              ],
              ports: [
                {
                  name: "game",
                  containerPort: 25565,
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [
                {
                  name: "data",
                  mountPath: "/data",
                },
              ],
            },
          ],
          securityContext: securityContext.pod,
        },
      },
      volumeClaimTemplates: [
        {
          metadata: {
            name: "data",
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: "10Gi" as any,
              },
            },
            storageClassName: "replicated",
          },
        } as PersistentVolumeClaimTemplate,
      ] as any,
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": id,
      },
      ports: [
        {
          port: 25565,
          name: "game",
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "minecraft.bulia.dev", 25565, service, 25565);

  new TcpRoute(chart, "public", "minecraft.bfiola.dev", 25565, service, 25565);

  return chart;
};
