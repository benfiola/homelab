import { Chart, Kustomization } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  await Kustomization.init(chart, `${id}-kustomization`, {
    dynamic: {
      namespace: chart.namespace,
      resources: [context.getAsset("manifest.yaml")],
    },
  });

  return chart;
};
