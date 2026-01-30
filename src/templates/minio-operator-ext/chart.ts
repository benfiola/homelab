import {
  Chart,
  findApiObject,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  new Helm(chart, `${id}-helm-crds`, context.getAsset("chart-crds.tar.gz"));

  new Helm(
    chart,
    `${id}-helm-operator`,
    context.getAsset("chart-operator.tar.gz")
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "minio-operator-ext",
    })
  );

  return chart;
};
