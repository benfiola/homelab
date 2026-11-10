import type { AppFunction } from "../../tools/lib/app.ts";

// kubernetes names can't contain the '.' and '_' the mixin's names do
const k8sName = (name: string) => name.replace(/[._]/g, "-");

const instanceSelector = () => ({ matchLabels: { instance: "grafana" } });

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  // { alerts, dashboards, rules } from the kubernetes-mixin (see main.jsonnet)
  const mixin = await ns.jsonnet("main.jsonnet");

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
      instanceSelector: instanceSelector(),
    },
  });

  ns.add({
    apiVersion: "grafana.integreatly.org/v1beta1",
    kind: "GrafanaDatasource",
    metadata: { name: "loki" },
    spec: {
      allowCrossNamespaceImport: true,
      datasource: {
        access: "proxy",
        editable: false,
        name: "Loki",
        type: "loki",
        url: "http://loki-gateway.loki.svc",
      },
      instanceSelector: instanceSelector(),
    },
  });

  // what prometheus scrapes with: a service account and a token for it
  ns.add(
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: h.app },
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: { name: h.app },
      rules: [
        { apiGroups: [""], resources: ["nodes/metrics"], verbs: ["get"] },
        {
          apiGroups: [""],
          resources: ["endpoints", "pods", "services"],
          verbs: ["get", "list", "watch"],
        },
        { nonResourceURLs: ["/metrics"], verbs: ["get"] },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: { name: h.app },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: h.app,
      },
      subjects: [{ kind: "ServiceAccount", name: h.app, namespace: ns.name }],
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: h.app,
        annotations: { "kubernetes.io/service-account.name": h.app },
      },
      type: "kubernetes.io/service-account-token",
    },
  );

  const token = () => ({ key: "token", name: h.app });
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

  const prometheusRule = (name: string, group: Record<string, any>) =>
    ns.add({
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PrometheusRule",
      metadata: { name },
      spec: { groups: [group] },
    });
  for (const group of mixin.rules) {
    prometheusRule(`rule--${k8sName(group.name)}`, group);
  }
  for (const group of mixin.alerts) {
    prometheusRule(`alert--${k8sName(group.name)}`, group);
  }

  prometheusRule("rule--pod-oom-killed", {
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
  });

  // grafana picks up any ConfigMap labelled as a dashboard
  for (const [name, dashboard] of Object.entries(mixin.dashboards)) {
    ns.add({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name: `dashboard--${k8sName(name)}`,
        labels: { grafana_dashboard: "1" },
      },
      data: { [name]: JSON.stringify(dashboard) },
    });
  }
};
