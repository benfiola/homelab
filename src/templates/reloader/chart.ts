import {
  Chart,
  findApiObject,
  getSecurityContext,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const securityContext = getSecurityContext();

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    reloader: {
      autoReloadAll: true,
      deployment: {
        securityContext: securityContext.pod,
        containerSecurityContext: securityContext.container,
      },
      reloadStrategy: "annotations",
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "reloader-reloader",
    }),
  );

  return chart;
};
