import {
  Chart,
  findApiObject,
  getSecurityContext,
  Kustomization,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const securityContext = getSecurityContext();

  await Kustomization.init(chart, `${id}-kustomization`, {
    dynamic: {
      namespace: chart.namespace,
      resources: [context.getAsset("manifest.yaml")],
      patchesJson6902: [
        {
          target: {
            group: "apps",
            version: "v1",
            kind: "Deployment",
            name: "snapshot-controller",
          },
          patch: stringify([
            {
              op: "replace",
              path: "/spec/template/spec/securityContext",
              value: securityContext.pod,
            },
            {
              op: "replace",
              path: "/spec/template/spec/containers/0/securityContext",
              value: securityContext.container,
            },
          ]),
        },
      ],
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "snapshot-controller",
    }),
  );

  return chart;
};
