import { ConfigMap } from "../../../assets/kubernetes/k8s";
import { Chart, Deployment, HttpRoute, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const configMap = new ConfigMap(chart, "home-assistant", {
    metadata: {
      name: "home-assistant",
    },
    data: {
      "configuration.yaml": stringify({
        http: {
          use_x_forwarded_for: true,
          trusted_proxies: ["192.168.33.2"],
        },
      }),
    },
  });

  const deployment = new Deployment(chart, "home-assistant", {
    securityContext: { gid: 0, uid: 0 },
    volumes: {
      config: { configMap: configMap.name },
    },
  });

  deployment.addContainer(
    "home-assistant",
    "ghcr.io/home-assistant/home-assistant:2026.5.4",
    {
      env: {
        TZ: "America/Los_Angeles",
      },
      containerPorts: {
        web: [8123, "TCP"],
      },
      volumeMounts: {
        config: "/config",
      },
    },
  );

  const service = deployment.createService({ web: 8123 });

  new HttpRoute(chart, "users", "home-assistant.bulia.dev").match(
    service,
    8123,
  );

  return chart;
};
