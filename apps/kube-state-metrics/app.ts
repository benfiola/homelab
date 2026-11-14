import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

const fluxResources: [
  string,
  string,
  string,
  string,
  Record<string, string[]>,
][] = [
  [
    "kustomize.toolkit.fluxcd.io",
    "v1",
    "Kustomization",
    "kustomizations",
    {
      revision: ["status", "lastAppliedRevision"],
      source_name: ["spec", "sourceRef", "name"],
    },
  ],
  [
    "helm.toolkit.fluxcd.io",
    "v2",
    "HelmRelease",
    "helmreleases",
    {
      revision: ["status", "history", "0", "chartVersion"],
      chart_name: ["status", "history", "0", "chartName"],
      chart_app_version: ["status", "history", "0", "appVersion"],
      chart_ref_name: ["spec", "chartRef", "name"],
      chart_source_name: ["spec", "chart", "spec", "sourceRef", "name"],
    },
  ],
  [
    "source.toolkit.fluxcd.io",
    "v1",
    "GitRepository",
    "gitrepositories",
    { revision: ["status", "artifact", "revision"], url: ["spec", "url"] },
  ],
  [
    "source.toolkit.fluxcd.io",
    "v1",
    "Bucket",
    "buckets",
    {
      revision: ["status", "artifact", "revision"],
      endpoint: ["spec", "endpoint"],
      bucket_name: ["spec", "bucketName"],
    },
  ],
  [
    "source.toolkit.fluxcd.io",
    "v1",
    "HelmRepository",
    "helmrepositories",
    { revision: ["status", "artifact", "revision"], url: ["spec", "url"] },
  ],
  [
    "source.toolkit.fluxcd.io",
    "v1",
    "HelmChart",
    "helmcharts",
    {
      revision: ["status", "artifact", "revision"],
      chart_name: ["spec", "chart"],
      chart_version: ["spec", "version"],
    },
  ],
  [
    "source.toolkit.fluxcd.io",
    "v1",
    "OCIRepository",
    "ocirepositories",
    { revision: ["status", "artifact", "revision"], url: ["spec", "url"] },
  ],
  ["notification.toolkit.fluxcd.io", "v1beta3", "Alert", "alerts", {}],
  ["notification.toolkit.fluxcd.io", "v1beta3", "Provider", "providers", {}],
  [
    "notification.toolkit.fluxcd.io",
    "v1",
    "Receiver",
    "receivers",
    { webhook_path: ["status", "webhookPath"] },
  ],
];

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "https://prometheus-community.github.io/helm-charts/kube-state-metrics?version=9.0.1",
    {
      values: {
        prometheus: { monitor: { enabled: true, http: { honorLabels: true } } },
        rbac: {
          extraRules: [
            {
              apiGroups: [...new Set(fluxResources.map(([group]) => group))],
              resources: fluxResources.map(([, , , plural]) => plural),
              verbs: ["list", "watch"],
            },
          ],
        },
        customResourceState: {
          enabled: true,
          config: {
            spec: {
              resources: fluxResources.map(
                ([group, version, kind, , extra]) => ({
                  groupVersionKind: { group, version, kind },
                  metricNamePrefix: "gotk",
                  metrics: [
                    {
                      name: "resource_info",
                      help: `The current state of a Flux ${kind} resource.`,
                      each: {
                        type: "Info",
                        info: {
                          labelsFromPath: { name: ["metadata", "name"] },
                        },
                      },
                      labelsFromPath: {
                        exported_namespace: ["metadata", "namespace"],
                        ...(extra.revision || kind === "Receiver"
                          ? {
                              ready: [
                                "status",
                                "conditions",
                                "[type=Ready]",
                                "status",
                              ],
                            }
                          : {}),
                        suspended: ["spec", "suspend"],
                        ...extra,
                      },
                    },
                  ],
                }),
              ),
            },
          },
        },
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
