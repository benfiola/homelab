import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dashboardConfigMaps,
  prometheusRules,
} from "../../tools/lib/k8s/monitoring.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const security = h.securityContext();

  const ns = h.namespace();

  ns.add(
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
        securityContext: security.pod,
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

  // the datasource grafana queries prometheus through
  ns.add({
    apiVersion: "grafana.integreatly.org/v1beta1",
    kind: "GrafanaDatasource",
    metadata: { name: "prometheus" },
    spec: {
      allowCrossNamespaceImport: true,
      datasource: {
        access: "proxy",
        editable: false,
        isDefault: true,
        name: "Prometheus",
        type: "prometheus",
        url: "http://prometheus-operated.prometheus.svc:9090",
      },
      instanceSelector: { matchLabels: { instance: "grafana" } },
    },
  });

  // the monitors below scrape with prometheus's own service account, through a token for it
  ns.add({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "prometheus-token",
      annotations: { "kubernetes.io/service-account.name": "prometheus" },
    },
    type: "kubernetes.io/service-account-token",
  });

  const token = () => ({ key: "token", name: "prometheus-token" });
  const insecureHttps = () => ({
    scheme: "https",
    tlsConfig: { insecureSkipVerify: true },
  });
  const monitor = (name: string, spec: Record<string, any>) =>
    ns.add({
      apiVersion: "monitoring.coreos.com/v1",
      kind: "ServiceMonitor",
      metadata: { name },
      spec,
    });
  const nameSelector = (name: string) => ({
    matchLabels: { "app.kubernetes.io/name": name },
  });

  monitor("kubelet", {
    endpoints: [
      {
        bearerTokenSecret: token(),
        interval: "30s",
        port: "https-metrics",
        ...insecureHttps(),
      },
      {
        bearerTokenSecret: token(),
        interval: "30s",
        port: "https-metrics",
        metricRelabelings: [
          {
            sourceLabels: ["namespace"],
            targetLabel: "job_namespace",
            replacement: "$1",
          },
          {
            sourceLabels: ["exported_namespace"],
            targetLabel: "namespace",
            replacement: "$1",
          },
        ],
        relabelings: [{ targetLabel: "job", replacement: "cadvisor" }],
        ...insecureHttps(),
        path: "/metrics/cadvisor",
      },
    ],
    namespaceSelector: { matchNames: ["kube-system"] },
    selector: nameSelector("kubelet"),
    serviceDiscoveryRole: "EndpointSlice",
  });

  monitor("kube-apiserver", {
    endpoints: [
      {
        bearerTokenSecret: token(),
        port: "https",
        interval: "30s",
        relabelings: [{ targetLabel: "job", replacement: "kube-apiserver" }],
        ...insecureHttps(),
      },
    ],
    namespaceSelector: { matchNames: ["default"] },
    selector: {
      matchLabels: { component: "apiserver", provider: "kubernetes" },
    },
  });

  // the control plane components run outside the cluster's services, so each gets a headless
  // service for its metrics port (the endpoints are filled in by talos) and a monitor for it
  for (const [name, port] of [
    ["kube-controller-manager", 10257],
    ["kube-scheduler", 10259],
  ] as const) {
    ns.add({
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name,
        namespace: "kube-system",
        labels: { "app.kubernetes.io/name": name },
      },
      spec: {
        selector: { "app.kubernetes.io/name": name },
        clusterIP: "None",
        ports: [{ name: "http-metrics", port }],
      },
    });

    monitor(name, {
      endpoints: [
        {
          bearerTokenSecret: token(),
          port: "http-metrics",
          interval: "30s",
          ...insecureHttps(),
        },
      ],
      namespaceSelector: { matchNames: ["kube-system"] },
      selector: nameSelector(name),
    });
  }

  const mixin = await ns.jsonnet("main.jsonnet");
  ns.add(
    ...prometheusRules("alert", mixin.alerts),
    ...dashboardConfigMaps(h.app, mixin.dashboards),
  );

  ns.podMonitor(
    "prometheus",
    { "app.kubernetes.io/name": "prometheus" },
    "web",
  );

  ns.vpa({
    kind: "Prometheus",
    name: "prometheus",
    apiVersion: "monitoring.coreos.com/v1",
  });
};

export const network: NetworkFunction = (n) => {
  const prometheus = n.subject("prometheus", pod("prometheus", "prometheus"));

  n.host.to(prometheus, tcp(9090));
  // what it scrapes outside the apps' own monitors. each app allows prometheus to reach the
  // metrics of its own subjects (`n.ref("prometheus").to(subject, ...)`)
  prometheus
    .to(prometheus, tcp(9090))
    .to(n.ref("alertmanager"), tcp(9093))
    // node exporter, kubelet, the control plane, and cilium's agent, operator and envoy
    .to(n.nodes, tcp(9100, 9962, 9963, 9964, 10250, 10257, 10259))
    .to(n.kubeApiServer, tcp(6443));
};
