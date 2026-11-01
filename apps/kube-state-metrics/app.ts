import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://prometheus-community.github.io/helm-charts/kube-state-metrics?version=8.8.0",
  );

  h.namespace();

  h.vpa({ kind: "Deployment", name: "kube-state-metrics" });
};

export const network: NetworkFunction = (n) => {
  const kubeStateMetrics = n.subject(
    "kube-state-metrics",
    component("metrics", "kube-state-metrics"),
  );

  kubeStateMetrics.to(n.kubeApiServer, tcp(6443));
  n.host.to(kubeStateMetrics, tcp(8080, 8081));
};
