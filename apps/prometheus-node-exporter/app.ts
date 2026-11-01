import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://prometheus-community.github.io/helm-charts/prometheus-node-exporter?version=4.60.1",
    { values: "values.yaml" },
  );

  h.namespace({ privileged: true });

  h.vpa({ kind: "DaemonSet", name: "prometheus-node-exporter" });
};
