import {
  Kustomization,
  KustomizationSpecSourceRefKind as SourceRef,
} from "../../../assets/flux/kustomize.toolkit.fluxcd.io";
import { Chart } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name, {
    namespace: "flux-system",
  });
  const id = chart.node.id;

  new Kustomization(chart, `${id}-kustomization`, {
    metadata: {
      name: id,
    },
    spec: {
      interval: "30s",
      path: "./apps/flux",
      prune: true,
      sourceRef: {
        kind: SourceRef.GIT_REPOSITORY,
        namespace: "flux-system",
        name: "flux-system",
      },
    },
  });

  return chart;
};
