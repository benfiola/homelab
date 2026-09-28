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
    kind: "Deployment",
    podSecurityContext: securityContext.pod,
    securityContext: securityContext.container,
    resources: {
      requests: { cpu: "25m", memory: "256Mi" },
      limits: null,
    },
    deschedulerPolicy: {
      profiles: [
        {
          name: "default",
          pluginConfig: [
            {
              name: "DefaultEvictor",
              args: {
                nodeFit: true,
                podProtections: {
                  defaultDisabled: ["PodsWithLocalStorage"],
                  extraEnabled: ["PodsWithPVC"],
                },
              },
            },
            { name: "RemoveDuplicates" },
            {
              name: "RemovePodsHavingTooManyRestarts",
              args: { podRestartThreshold: 100, includingInitContainers: true },
            },
            {
              name: "RemovePodsViolatingNodeAffinity",
              args: {
                nodeAffinityType: [
                  "requiredDuringSchedulingIgnoredDuringExecution",
                ],
              },
            },
            { name: "RemovePodsViolatingNodeTaints" },
            { name: "RemovePodsViolatingInterPodAntiAffinity" },
            { name: "RemovePodsViolatingTopologySpreadConstraint" },
            {
              name: "LowNodeUtilization",
              args: {
                thresholds: { cpu: 20, memory: 20, pods: 20 },
                targetThresholds: { cpu: 50, memory: 50, pods: 50 },
              },
            },
          ],
          plugins: {
            balance: {
              enabled: [
                "RemoveDuplicates",
                "RemovePodsViolatingTopologySpreadConstraint",
                "LowNodeUtilization",
              ],
            },
            deschedule: {
              enabled: [
                "RemovePodsHavingTooManyRestarts",
                "RemovePodsViolatingNodeTaints",
                "RemovePodsViolatingNodeAffinity",
                "RemovePodsViolatingInterPodAntiAffinity",
              ],
            },
          },
        },
      ],
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "descheduler",
    }),
  );

  return chart;
};
