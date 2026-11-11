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

  ns.add({
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: { name: "rule--pod-oom-killed" },
    spec: {
      groups: [
        {
          name: "kubernetes.rules",
          interval: "30s",
          rules: [
            {
              alert: "PodOOMKilled",
              expr: 'kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1',
              for: "1m",
              labels: { severity: "critical" },
              annotations: {
                summary:
                  "Pod {{ $labels.namespace }}/{{ $labels.pod }} was OOMKilled",
                description:
                  "Pod {{ $labels.namespace }}/{{ $labels.pod }} in container {{ $labels.container }} was OOMKilled in the last 1 minute.",
              },
            },
          ],
        },
      ],
    },
  });

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
