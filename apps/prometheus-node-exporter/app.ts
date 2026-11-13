import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dashboardConfigMaps,
  prometheusRules,
} from "../../tools/lib/k8s/monitoring.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm(
    "https://prometheus-community.github.io/helm-charts/prometheus-node-exporter?version=5.0.1",
    {
      values: {
        // the kubernetes mixin selects node exporter by this job name
        prometheus: {
          monitor: {
            enabled: true,
            relabelings: [{ targetLabel: "job", replacement: "node-exporter" }],
          },
        },
        tolerations: [{ operator: "Exists" }],
      },
    },
  );

  const mixin = await ns.jsonnet("main.jsonnet");
  ns.add(
    ...prometheusRules("rule", mixin.rules),
    ...prometheusRules("alert", mixin.alerts),
    ...dashboardConfigMaps(h.app, mixin.dashboards),
  );

  ns.vpa({ kind: "DaemonSet", name: "prometheus-node-exporter" });
};
