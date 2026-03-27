import { Chart, Helm } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, {
    namespace: "intel-device-plugins-operator",
  });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    name: "gpu-device-plugin",
  });

  return chart;
};
