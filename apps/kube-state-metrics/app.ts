import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "https://prometheus-community.github.io/helm-charts/kube-state-metrics?version=9.0.0",
    {
      values: {
        prometheus: { monitor: { enabled: true, http: { honorLabels: true } } },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "kube-state-metrics" });
};

export const network: NetworkFunction = (n) => {
  const kubeStateMetrics = n.subject(
    "kube-state-metrics",
    component("metrics", "kube-state-metrics"),
  );

  kubeStateMetrics.to(n.kubeApiServer, tcp(6443));
  n.host.to(kubeStateMetrics, tcp(8080, 8081));
  n.ref("prometheus").to(kubeStateMetrics, tcp(8080));
};
