import { Chart } from "cdk8s";
import { VerticalPodAutoscaler } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name, {
    disableResourceNameHashes: true,
    namespace: "kube-system",
  });

  new VerticalPodAutoscaler(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "coredns",
  });

  new VerticalPodAutoscaler(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "kustomize-controller",
  });

  new VerticalPodAutoscaler(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "notification-controller",
  });

  new VerticalPodAutoscaler(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "source-controller",
  });

  return chart;
};
