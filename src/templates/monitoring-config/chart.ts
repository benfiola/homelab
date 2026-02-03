import path from "path";
import { GrafanaDatasource } from "../../../assets/grafana-operator/grafana.integreatly.org";
import {
  ServiceMonitorSpecEndpointsRelabelingsAction as Action,
  ServiceMonitorSpecEndpoints as Endpoint,
  PrometheusRule,
  PrometheusRuleSpecGroupsRules as Rule,
  ServiceMonitorSpecEndpointsScheme as Scheme,
  ServiceMonitor,
} from "../../../assets/prometheus-operator/monitoring.coreos.com";
import { Chart, Namespace } from "../../cdk8s";
import { TemplateChartContext, TemplateChartFn } from "../../context";
import * as jsonnet from "../../jsonnet";

const getMonitoringConfig = async (context: TemplateChartContext) => {
  const libs = [context.getAsset("jsonnet")];
  const contentStr = await jsonnet.evaluate({
    jsonnetFile: path.join(__dirname, "main.jsonnet"),
    libs,
  });
  const content = JSON.parse(contentStr);
  return content;
};

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  await getMonitoringConfig(context);

  return chart;
};

const createDatasources = async (chart: Chart) => {
  const id = chart.node.id;

  new GrafanaDatasource(chart, `${id}-datasource-prometheus`, {
    metadata: {
      name: "prometheus",
    },
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
      instanceSelector: {
        matchLabels: {
          instance: "grafana",
        },
      },
    },
  });

  new GrafanaDatasource(chart, `${id}-datasource-loki`, {
    metadata: {
      name: "loki",
    },
    spec: {
      allowCrossNamespaceImport: true,
      datasource: {
        access: "proxy",
        editable: false,
        name: "Loki",
        type: "loki",
        url: "http://loki-gateway.loki.svc",
      },
      instanceSelector: {
        matchLabels: {
          instance: "grafana",
        },
      },
    },
  });
};

const createServiceMonitors = async (chart: Chart) => {
  const id = `${chart.node.id}-service-monitor`;

  let kubeletEndpoint: Endpoint = {
    bearerTokenFile: "/var/run/secrets/kubernetes.io/serviceaccount/token",
    interval: "30s",
    port: "https-metrics",
    relabelings: [
      {
        sourceLabels: ["__meta_kubernetes_node_name"],
        action: Action.REPLACE,
        targetLabel: "node",
      },
    ],
    scheme: Scheme.HTTPS,
    tlsConfig: {
      insecureSkipVerify: true,
    },
  };

  new ServiceMonitor(chart, `${id}-kubelet`, {
    metadata: {
      name: "kubelet",
    },
    spec: {
      endpoints: [
        {
          ...kubeletEndpoint,
        },
        {
          ...kubeletEndpoint,
          path: "/metrics/cadvisor",
        },
      ],
      namespaceSelector: {
        matchNames: ["kube-system"],
      },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "kubelet",
        },
      },
    },
  });

  new ServiceMonitor(chart, `${id}-kube-state-metrics`, {
    metadata: {
      name: "kube-state-metrics",
    },
    spec: {
      endpoints: [
        {
          port: "http",
          interval: "30s",
        },
      ],
      namespaceSelector: {
        matchNames: ["kube-state-metrics"],
      },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "kube-state-metrics",
        },
      },
    },
  });

  new ServiceMonitor(chart, `${id}-prometheus-node-exporter`, {
    metadata: {
      name: "prometheus-node-exporter",
    },
    spec: {
      endpoints: [
        {
          port: "metrics",
          interval: "30s",
        },
      ],
      namespaceSelector: {
        matchNames: ["prometheus-node-exporter"],
      },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "prometheus-node-exporter",
        },
      },
    },
  });
};

const createPrometheusRules = async (chart: Chart) => {
  const id = `${chart.node.id}-prometheus-rule`;

  let rules: Rule[] = [
    {
      alert: "ContainerHighCpuUsage",
      expr: {
        value:
          '(sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (namespace, pod, container) / sum(container_spec_cpu_quota{container!=""}/(container_spec_cpu_period{container!=""} > 0)) by (namespace, pod, container)) > 0.9',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary:
          "Container {{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} is using high CPU",
        description:
          "Container {{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} is using {{ $value | humanizePercentage }} of CPU limit.",
      },
    },
    {
      alert: "ContainerHighMemoryUsage",
      expr: {
        value:
          '(sum(container_memory_working_set_bytes{container!=""}) by (namespace, pod, container) / sum(container_spec_memory_limit_bytes{container!=""} > 0) by (namespace, pod, container)) > 0.9',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary:
          "Container {{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} is using high memory",
        description:
          "Container {{ $labels.container }} in {{ $labels.namespace }}/{{ $labels.pod }} is using {{ $value | humanizePercentage }} of memory limit.",
      },
    },
    {
      alert: "NodeCPUPressure",
      expr: {
        value:
          'kube_node_status_condition{condition="CPUPressure",status="true"} == 1',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary: "Node {{ $labels.node }} has CPU pressure",
        description: "Node {{ $labels.node }} has CPU pressure condition.",
      },
    },
    {
      alert: "NodeDiskPressure",
      expr: {
        value:
          'kube_node_status_condition{condition="DiskPressure",status="true"} == 1',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary: "Node {{ $labels.node }} has disk pressure",
        description: "Node {{ $labels.node }} has disk pressure condition.",
      },
    },
    {
      alert: "NodeFilesystemUsageCritical",
      expr: {
        value:
          '(1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|squashfs"})) > 0.95',
      },
      for: "1m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary:
          "Filesystem on {{ $labels.instance }} at {{ $labels.mountpoint }} is {{ $value | humanizePercentage }} full",
        description:
          "Filesystem on {{ $labels.instance }} at {{ $labels.mountpoint }} is {{ $value | humanizePercentage }} full and may run out of space.",
      },
    },
    {
      alert: "NodeFilesystemUsageHigh",
      expr: {
        value:
          '(1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|squashfs"})) > 0.85',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary:
          "Filesystem on {{ $labels.instance }} at {{ $labels.mountpoint }} is {{ $value | humanizePercentage }} full",
        description:
          "Filesystem on {{ $labels.instance }} at {{ $labels.mountpoint }} is {{ $value | humanizePercentage }} full.",
      },
    },
    {
      alert: "NodeMemoryPressure",
      expr: {
        value:
          'kube_node_status_condition{condition="MemoryPressure",status="true"} == 1',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary: "Node {{ $labels.node }} has memory pressure",
        description: "Node {{ $labels.node }} has memory pressure condition.",
      },
    },
    {
      alert: "NodeNotReady",
      expr: {
        value:
          'kube_node_status_condition{condition="Ready",status!="true"} == 1',
      },
      for: "5m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary: "Node {{ $labels.node }} is not ready",
        description:
          "Node {{ $labels.node }} has been in non-Ready state for more than 5 minutes.",
      },
    },
    {
      alert: "NodePIDPressure",
      expr: {
        value:
          'kube_node_status_condition{condition="PIDPressure",status="true"} == 1',
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary: "Node {{ $labels.node }} has PID pressure",
        description: "Node {{ $labels.node }} has PID pressure condition.",
      },
    },
    {
      alert: "PersistentVolumeClaimNotHealthy",
      expr: {
        value:
          'kube_persistentvolumeclaim_status_phase{phase=~"Failed|Pending"} == 1',
      },
      for: "15m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary:
          "PVC {{ $labels.exported_namespace }}/{{ $labels.persistentvolumeclaim }} not healthy",
        description:
          "PVC {{ $labels.exported_namespace }}/{{ $labels.persistentvolumeclaim }} is in {{ $labels.phase }} state for more than 15m.",
      },
    },
    {
      alert: "PersistentVolumeClaimUsageCritical",
      expr: {
        value:
          "(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) > 0.95",
      },
      for: "1m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary:
          "PVC {{ $labels.exported_namespace }}/{{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full",
        description:
          "PVC {{ $labels.exported_namespace }}/{{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full and may run out of space soon.",
      },
    },
    {
      alert: "PersistentVolumeClaimUsageHigh",
      expr: {
        value:
          "(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) > 0.85",
      },
      for: "5m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary:
          "PVC {{ $labels.exported_namespace }}/{{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full",
        description:
          "PVC {{ $labels.exported_namespace }}/{{ $labels.persistentvolumeclaim }} is {{ $value | humanizePercentage }} full.",
      },
    },
    {
      alert: "PersistentVolumeNotHealthy",
      expr: {
        value: 'kube_persistentvolume_status_phase{phase="Failed"} == 1',
      },
      for: "15m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary:
          "PersistentVolume {{ $labels.persistentvolume }} is not healthy",
        description:
          "PersistentVolume {{ $labels.persistentvolume }} is in {{ $labels.phase }} state for more than 15m.",
      },
    },
    {
      alert: "PodCrashLooping",
      expr: {
        value:
          'kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1',
      },
      for: "5m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary:
          "Pod {{ $labels.exported_namespace }}/{{ $labels.exported_pod }} is crash looping",
        description:
          "Pod {{ $labels.exported_namespace }}/{{ $labels.exported_pod }} in container {{ $labels.exported_container }} is crash looping.",
      },
    },
    {
      alert: "PodNotHealthy",
      expr: {
        value: 'kube_pod_status_phase{phase!~"Running|Succeeded"} == 1',
      },
      for: "15m",
      labels: {
        severity: "warning",
      },
      annotations: {
        summary:
          "Pod {{ $labels.exported_namespace }}/{{ $labels.exported_pod }} is not healthy",
        description:
          "Pod {{ $labels.exported_namespace }}/{{ $labels.exported_pod }} is in {{ $labels.phase }} state for more than 15m.",
      },
    },
    {
      alert: "PodOOMKilled",
      expr: {
        value:
          'kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1',
      },
      for: "1m",
      labels: {
        severity: "critical",
      },
      annotations: {
        summary:
          "Pod {{ $labels.exported_namespace }}/{{ $labels.exported_pod }} was OOMKilled",
        description:
          "Pod {{ $labels.exported_namespace }}/{{ $labels.exported_pod }} in container {{ $labels.exported_container }} was OOMKilled in the last 1 minute.",
      },
    },
  ];

  new PrometheusRule(chart, `${id}-kubernetes`, {
    metadata: {
      name: "kubernetes",
    },
    spec: {
      groups: [
        {
          name: "kubernetes.rules",
          interval: "30s",
          rules,
        },
      ],
    },
  });
};
