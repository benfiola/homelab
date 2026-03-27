import { ApiObject } from "cdk8s";
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

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"));

  const deployment = findApiObject(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "inteldeviceplugins-controller-manager",
  });

  patchPodLabel(deployment, id);

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};

const patchPodLabel = (deployment: ApiObject, name: string) => {
  const props = (deployment as any).props;
  props.spec.template.metadata.labels = {
    ...props.spec.template.metadata.labels,
    "app.kubernetes.io/name": name,
  };
};
