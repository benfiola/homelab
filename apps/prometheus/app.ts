import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  h.add(
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: "prometheus" },
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: { name: "prometheus" },
      rules: [
        {
          apiGroups: [""],
          resources: [
            "endpoints",
            "nodes",
            "nodes/metrics",
            "pods",
            "services",
          ],
          verbs: ["get", "list", "watch"],
        },
        {
          apiGroups: [""],
          resources: ["configmaps"],
          verbs: ["get"],
        },
        {
          apiGroups: ["discovery.k8s.io"],
          resources: ["endpointslices"],
          verbs: ["get", "list", "watch"],
        },
        {
          apiGroups: ["networking.k8s.io"],
          resources: ["ingresses"],
          verbs: ["get", "list", "watch"],
        },
        {
          nonResourceURLs: ["/metrics"],
          verbs: ["get"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: { name: "prometheus" },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "prometheus",
      },
      subjects: [
        { kind: "ServiceAccount", name: "prometheus", namespace: h.app },
      ],
    },
    {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "Prometheus",
      metadata: { name: "prometheus" },
      spec: {
        alerting: {
          alertmanagers: [
            {
              name: "alertmanager-operated",
              namespace: "alertmanager",
              port: 9093,
            },
          ],
        },
        containers: [
          {
            name: "config-reloader",
            resources: { requests: { cpu: "25m", memory: "128Mi" } },
          },
        ],
        initContainers: [
          {
            name: "init-config-reloader",
            resources: { requests: { cpu: "10m", memory: "64Mi" } },
          },
        ],
        evaluationInterval: "30s",
        podMonitorNamespaceSelector: {},
        podMonitorSelector: {},
        retention: "30d",
        ruleNamespaceSelector: {},
        ruleSelector: {},
        scrapeClasses: [
          {
            default: true,
            name: "cluster-relabeling",
            relabelings: [
              { targetLabel: "cluster", replacement: "cluster.fiola.dev" },
            ],
          },
        ],
        scrapeConfigNamespaceSelector: {},
        scrapeConfigSelector: {},
        scrapeInterval: "30s",
        securityContext: {
          fsGroup: 65534,
          runAsGroup: 65534,
          runAsNonRoot: true,
          runAsUser: 65534,
          seccompProfile: { type: "RuntimeDefault" },
        },
        serviceAccountName: "prometheus",
        serviceMonitorNamespaceSelector: {},
        serviceMonitorSelector: {},
        shards: 1,
        storage: {
          volumeClaimTemplate: {
            metadata: { name: "data" },
            spec: {
              resources: { requests: { storage: "60Gi" } },
              storageClassName: "standard",
            },
          },
        },
      },
    },
  );

  h.vpa({
    kind: "Prometheus",
    name: "prometheus",
    apiVersion: "monitoring.coreos.com/v1",
  });
};

export const network: NetworkFunction = (n) => {
  const prometheus = n.subject("prometheus", pod("prometheus", "prometheus"));

  n.host.to(prometheus, tcp(9090));
  prometheus
    .to(n.ref("alertmanager"), tcp(9093))
    .to(n.nodes, tcp(9100, 10250, 10257, 10259))
    .to(n.kubeApiServer, tcp(6443))
    .to(n.ref("kube-state-metrics"), tcp(8080))
    .to(n.ref("nvidia-gpu-operator"), tcp(8080));
};
