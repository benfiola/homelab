import { Chart, Helm, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    nodePathMap: [
      {
        node: "DEFAULT_PATH_FOR_NON_LISTED_NODES",
        paths: ["/var/mnt/local-path-provisioner"],
      },
    ],
    storageClass: {
      create: false,
    },
  });

  return chart;
};
