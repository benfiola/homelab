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
    controller: {
      resources: {
        csiProvisioner: {
          limits: null,
          requests: null,
        },
        csiResizer: {
          limits: null,
          requests: null,
        },
        livenessProbe: {
          limits: null,
          requests: null,
        },
        nfs: {
          limits: null,
          requests: null,
        },
      },
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "csi-nfs-controller",
    }),
  );

  return chart;
};
