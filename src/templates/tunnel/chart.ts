import { ConfigMap } from "../../../assets/kubernetes/k8s";
import { Chart, Deployment, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);
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

  const deployment = new Deployment(chart, "tunnel", {
    volumes: {
      config: { configMap: config.name },
    },
  });
  deployment.addContainer("tunnel", "fatedier/frps:v0.63.0", {
    containerPorts: { server: 8080, desktop: 8081 },
    args: ["--config", "/config/config.json"],
    volumeMounts: {
      config: "/config",
    },
  });

  const svc = deployment.createService({ server: 8080, desktop: 8081 });

  return chart;
};
