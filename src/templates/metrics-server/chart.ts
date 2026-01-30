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

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    args: [
      "--kubelet-insecure-tls",
      "--kubelet-preferred-address-types=InternalIP",
    ],
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "metrics-server",
    })
  );

  return chart;
};
