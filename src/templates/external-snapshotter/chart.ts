import {
  Chart,
  findApiObject,
  Kustomization,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  await Kustomization.init(chart, `${id}-kustomization`, {
    dynamic: {
      namespace: chart.namespace,
      resources: [context.getAsset("manifest.yaml")],
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "snapshot-controller",
    })
  );

  return chart;
};
