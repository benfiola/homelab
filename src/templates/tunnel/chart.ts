import { ConfigMap, Deployment, Service } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getSecurityContext,
  HttpRoute,
  Namespace,
  TcpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const config = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "tunnel",
    },
    data: {
      "config.json": JSON.stringify({
        bindPort: 8080,
      }),
    },
  });

  const securityContext = getSecurityContext();

  new Deployment(chart, `${id}-deployment`, {
    metadata: {
      name: "tunnel",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "tunnel",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "tunnel",
          },
        },
        spec: {
          containers: [
            {
              name: "tunnel",
              image: "fatedier/frps:v0.63.0",
              args: ["--config", "/config/config.json"],
              ports: [
                {
                  name: "server",
                  containerPort: 8080,
                },
                {
                  name: "desktop",
                  containerPort: 8081,
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [
                {
                  name: "config",
                  mountPath: "/config",
                },
              ],
            },
          ],
          securityContext: securityContext.pod,
          volumes: [
            {
              name: "config",
              configMap: {
                name: config.name,
              },
            },
          ],
        },
      },
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "tunnel",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": "tunnel",
      },
      ports: [
        {
          name: "server",
          port: 8080,
        },
        {
          name: "desktop",
          port: 8081,
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "tunnel.bulia.dev", 8080).match(service, 8080);

  new HttpRoute(chart, "trusted", "desktop.bulia.dev").match(service, 8081);

  return chart;
};
