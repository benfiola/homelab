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
    master: {
      resources: { limits: null },
    },
    worker: {
      config: {
        core: {
          labelSources: ["kernel", "pci"],
        },
      },
      resources: { limits: null },
    },
    gc: {
      resources: { limits: null },
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "node-feature-discovery-master",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "node-feature-discovery-gc",
    }),
  );

  return chart;
};
