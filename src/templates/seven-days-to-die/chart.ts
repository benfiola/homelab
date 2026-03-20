import { Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getSecurityContext,
  Namespace,
  TcpRoute,
  UdpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "seven-days-to-die",
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
          nodeSelector: {
            "kubernetes.io/arch": "amd64",
          },
          containers: [
            {
              name: "seven-days-to-die",
              image:
                "ghcr.io/benfiola/game-server-images/seven-days-to-die:0.1.0-alpha-feat-initial.33",
              env: [{ name: "LOG_LEVEL", value: "debug" }],
              ports: [
                {
                  name: "tcp",
                  containerPort: 26900,
                },
                {
                  name: "udp1",
                  containerPort: 26900,
                  protocol: "UDP",
                },
                {
                  name: "udp2",
                  containerPort: 26901,
                  protocol: "UDP",
                },
                {
                  name: "udp3",
                  containerPort: 26902,
                  protocol: "UDP",
                },
                {
                  name: "udp4",
                  containerPort: 26903,
                  protocol: "UDP",
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [{ name: "cache", mountPath: "/cache" }],
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
                storage: "30Gi",
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
      name: "seven-days-to-die",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": id,
      },
      ports: [
        {
          port: 26900,
          name: "tcp",
        },
        {
          port: 26900,
          name: "udp1",
          protocol: "UDP",
        },
        {
          port: 26901,
          name: "udp2",
          protocol: "UDP",
        },
        {
          port: 26902,
          name: "udp3",
          protocol: "UDP",
        },
        {
          port: 26903,
          name: "udp4",
          protocol: "UDP",
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "sdtd.bulia.dev", 26900).match(service, 26900);
  new UdpRoute(chart, "trusted", "sdtd.bulia.dev", 26900)
    .match(service, 26900)
    .match(service, 26901)
    .match(service, 26902)
    .match(service, 26903);

  return chart;
};
