import { ApiObject } from "cdk8s";
import path from "path";
import { GrafanaDatasource } from "../../../assets/grafana-operator/grafana.integreatly.org";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  ServiceMonitorSpecEndpoints as Endpoint,
  PrometheusRule,
  ServiceMonitorSpecEndpointsScheme as Scheme,
  ServiceMonitorSpecServiceDiscoveryRole as ServiceDiscoveryRole,
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

const getK8sName = (name: string) => {
  return name.replace(/[._]/g, "-");
};

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const monitoringConfig = await getMonitoringConfig(context);

  await createDatasources(chart);

  await createServiceMonitors(chart);

  await createPrometheusRules(chart, monitoringConfig);

  await createGrafanaDashboards(chart, monitoringConfig);

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
      serviceDiscoveryRole: ServiceDiscoveryRole.ENDPOINT_SLICE,
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

const createPrometheusRules = async (chart: Chart, monitoringConfig: any) => {
  const id = chart.node.id;

  for (const rule of monitoringConfig.rules) {
    new ApiObject(chart, `${id}-prometheus-rule-rule-${rule.name}`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PrometheusRule",
      metadata: {
        name: `rule--${getK8sName(rule.name)}`,
      },
      spec: {
        groups: [rule],
      },
    });
  }

  for (const alert of monitoringConfig.alerts) {
    new ApiObject(chart, `${id}-prometheus-rule-alert-${alert.name}`, {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PrometheusRule",
      metadata: {
        name: `alert--${getK8sName(alert.name)}`,
      },
      spec: {
        groups: [alert],
      },
    });
  }

  new PrometheusRule(chart, `${id}-kubernetes`, {
    metadata: {
      name: "rule--pod-oom-killed",
    },
    spec: {
      groups: [
        {
          name: "kubernetes.rules",
          interval: "30s",
          rules: [
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
          ],
        },
      ],
    },
  });
};

const createGrafanaDashboards = async (chart: Chart, monitoringConfig: any) => {
  const id = chart.node.id;

  for (const [name, dashboard] of Object.entries(monitoringConfig.dashboards)) {
    new ConfigMap(chart, `${id}-dashboard-${name}`, {
      metadata: {
        name: `dashboard--${getK8sName(name)}`,
        labels: {
          grafana_dashboard: "1",
        },
      },
      data: {
        [name]: JSON.stringify(dashboard),
      },
    });
  }
};
