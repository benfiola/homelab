import zod from "zod";
import {
  Kustomization,
  KustomizationSpecSourceRefKind as SourceRef,
} from "../../../assets/flux/kustomize.toolkit.fluxcd.io";
import { Chart, VerticalPodAutoscaler } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

const optsSchema = zod.object({
  charts: zod.array(zod.custom<Chart>()),
});

export const chart: TemplateChartFn = async (construct, _, context) => {
  const opts = await optsSchema.parseAsync(context.opts);

  const chart = new Chart(construct, context.name, {
    namespace: "flux-system",
  });
  const id = chart.node.id;

  const charts = opts.charts.sort((a, b) => a.node.id.localeCompare(b.node.id));

  const validCharts = new Set(charts.map((c) => c.node.id));

  interface Dependency {
    name: string;
  }
  const dependencies: Record<string, Dependency[]> = {};
  for (const subChart of charts) {
    let chartDeps = subChart.node.dependencies;
    chartDeps = chartDeps.filter((c) => validCharts.has(c.node.id));
    let deps = chartDeps.map((c) => ({ name: c.node.id }));
    dependencies[subChart.node.id] = deps;
  }

  for (const subChart of charts) {
    new Kustomization(chart, `${id}-${subChart.node.id}`, {
      metadata: {
        name: subChart.node.id,
      },
      spec: {
        dependsOn: dependencies[subChart.node.id],
        force: true,
        interval: "30s",
        path: `./apps/${subChart.node.id}`,
        prune: true,
        sourceRef: {
          kind: SourceRef.GIT_REPOSITORY,
          name: "flux-system",
          namespace: "flux-system",
        },
      },
    });
  }

  new VerticalPodAutoscaler(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "helm-controller",
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
