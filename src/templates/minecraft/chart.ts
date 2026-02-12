import { Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import { Chart, getSecurityContext, Namespace, UdpRoute } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const securityContext = getSecurityContext();

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "minecraft",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "minecraft",
          },
        },
        spec: {
          containers: [
            {
              name: "minecraft",
              image: "itzg/minecraft-server:java25-jdk",
              env: [
                { name: "UID", value: `${securityContext.pod.runAsUser}` },
                { name: "GID", value: `${securityContext.pod.runAsGroup}` },
                { name: "EULA", value: "true" },
                { name: "VERSION", value: "1.21.11" },
              ],
              ports: [
                {
                  name: "game",
                  protocol: "UDP",
                  containerPort: 25565,
                },
              ],
              securityContext: securityContext.container,
            },
          ],
          securityContext: securityContext.pod,
        },
      },
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": "minecraft",
      },
      ports: [
        {
          port: 25565,
          name: "game",
          protocol: "UDP",
        },
      ],
    },
  });

  new UdpRoute(chart, "trusted", "minecraft").match(service, "game");

  new UdpRoute(chart, "public", "minecraft").match(service, "game");

  return chart;
};
