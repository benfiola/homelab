import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm(
    "https://prometheus-community.github.io/helm-charts/prometheus-node-exporter?version=4.60.1",
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

  ns.vpa({ kind: "DaemonSet", name: "prometheus-node-exporter" });
};
