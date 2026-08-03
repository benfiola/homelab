import {
  Chart,
  findApiObject,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    dcgmExporter: {
      enabled: false,
    },
    driver: {
      enabled: false,
    },
    hostPaths: {
      driverInstallDir: "/usr/local",
    },
    migManager: {
      enabled: false,
    },
    nfd: {
      enabled: false,
    },
    nodeStatusExporter: {
      enabled: false,
    },
    operator: {
      resources: null,
    },
    toolkit: {
      enabled: false,
    },
  });

  const deployment = findApiObject(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "gpu-operator",
  });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
