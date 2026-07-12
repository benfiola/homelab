import { readFile } from "fs/promises";
import path from "path";
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
    alloy: {
      configMap: {
        content: (
          await readFile(path.join(__dirname, "config.alloy"))
        ).toString(),
      },
      enableReporting: false,
      securityContext: securityContext.container,
    },
    configReloader: {
      securityContext: securityContext.container,
    },
    crds: {
      enable: false,
    },
    global: {
      podSecurityContext: securityContext.pod,
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "alloy",
    }),
  );

  return chart;
};
