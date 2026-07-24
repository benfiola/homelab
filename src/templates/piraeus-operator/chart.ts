import {
  Chart,
  findApiObject,
  Kustomization,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  await Kustomization.init(chart, `${id}-kustomization`, {
    dynamic: {
      namespace: chart.namespace,
      resources: [context.getAsset("manifest.yaml")],
      labels: [
        {
          includeSelectors: true,
          pairs: {
            "app.kubernetes.io/name": "piraeus-operator",
          },
        },
      ],
      patches: [
        {
          target: { kind: "Deployment", name: "piraeus-operator-controller-manager" },
          patch: stringify({
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { name: "piraeus-operator-controller-manager" },
            spec: {
              template: {
                spec: {
                  containers: [{ name: "manager", resources: { limits: null } }],
                },
              },
            },
          }),
        },
        {
          target: { kind: "Deployment", name: "piraeus-operator-gencert" },
          patch: stringify({
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { name: "piraeus-operator-gencert" },
            spec: {
              template: {
                spec: {
                  containers: [{ name: "gencert", resources: { limits: null } }],
                },
              },
            },
          }),
        },
      ],
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "piraeus-operator-controller-manager",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "piraeus-operator-gencert",
    }),
  );

  return chart;
};
