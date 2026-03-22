import { Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import { Chart, getSecurityContext, Namespace, TcpRoute } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { gameServerImage } from "../../game-server-images";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

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
                  name: "tcp",
                  containerPort: 6969,
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [{ name: "cache", mountPath: "/cache" }],
              env: [
                { name: "VERSION", value: "4.0.13" },
                { name: "LOG_LEVEL", value: "debug" },
                {
                  name: "MOD_URLS",
                  value:
                    "https://github.com/njzydark/SPT-Backend-URL-Rewriter-Mod/releases/download/v1.0.0/SPT.Backend.URL.Rewriter.Release.1.0.0.zip",
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
          name: "tcp",
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "spt.bulia.dev", 6969, service, 6969);

  return chart;
};
