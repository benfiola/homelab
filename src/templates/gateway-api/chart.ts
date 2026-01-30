import { Include } from "cdk8s";
import { Chart } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Include(chart, `${id}-crds`, {
    url: context.getAsset("manifest.yaml"),
  });

  return chart;
};
