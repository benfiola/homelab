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

  new Helm(chart, `${id}-helm-crds`, context.getAsset("chart-crds.tar.gz"), {
    crds: { envoyGateway: { enabled: true } },
  });

  new Helm(
    chart,
    `${id}-helm-gateway`,
    context.getAsset("chart-gateway.tar.gz"),
    {
      certgen: {
        job: {
          pod: {
            labels: {
              "app.kubernetes.io/component": "certgen",
            },
          },
        },
      },
      deployment: {
        pod: {
          labels: {
            "app.kubernetes.io/component": "controller",
          },
        },
      },
      skipCRDs: true,
    },
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "envoy-gateway",
    }),
    { advisory: true },
  );

  return chart;
};
