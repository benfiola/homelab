import { URL } from "url";
import {
  ClusterRole,
  ClusterRoleBinding,
  ServiceAccount,
} from "../../../assets/kubernetes/k8s";
import {
  PrometheusSpecAlertingAlertmanagersPort as AlertmanagerPort,
  Prometheus,
  PrometheusSpecStorageVolumeClaimTemplateSpecResourcesRequests as Storage,
} from "../../../assets/prometheus-operator/monitoring.coreos.com";
import {
  Chart,
  HttpRoute,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const serviceAccount = new ServiceAccount(chart, `${id}-service-account`, {
    metadata: {
      name: "prometheus",
    },
  });

  const clusterRole = new ClusterRole(chart, `${id}-cluster-role`, {
    metadata: {
      name: "prometheus",
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["endpoints", "nodes", "nodes/metrics", "pods", "services"],
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
        nonResourceUrLs: ["/metrics"],
        verbs: ["get"],
      },
    ],
  });

  new ClusterRoleBinding(chart, `${id}-cluster-role-binding`, {
    metadata: {
      name: "prometheus",
    },
    roleRef: {
      apiGroup: clusterRole.apiGroup,
      kind: clusterRole.kind,
      name: clusterRole.name,
    },
    subjects: [
      {
        kind: serviceAccount.kind,
        name: serviceAccount.name,
        namespace: serviceAccount.metadata.namespace,
      },
    ],
  });

  const externalUrl = new URL("https://prometheus.bulia.dev");
  const prometheus = new Prometheus(chart, `${id}-prometheus`, {
    metadata: { name: "prometheus" },
    spec: {
      alerting: {
        alertmanagers: [
          {
            name: "alertmanager-operated",
            namespace: "alertmanager",
            port: AlertmanagerPort.fromNumber(9093),
          },
        ],
      },
      externalLabels: {
        cluster: "cluster.bulia.dev",
      },
      externalUrl: externalUrl.toString(),
      evaluationInterval: "30s",
      podMonitorNamespaceSelector: {},
      podMonitorSelector: {},
      retention: "30d",
      ruleNamespaceSelector: {},
      ruleSelector: {},
      scrapeInterval: "30s",
      securityContext: {
        fsGroup: 65534,
        runAsGroup: 65534,
        runAsNonRoot: true,
        runAsUser: 65534,
        seccompProfile: {
          type: "RuntimeDefault",
        },
      },
      serviceAccountName: serviceAccount.name,
      serviceMonitorNamespaceSelector: {},
      serviceMonitorSelector: {},
      shards: 1,
      storage: {
        volumeClaimTemplate: {
          spec: {
            resources: {
              requests: {
                storage: Storage.fromString("10Gi"),
              },
            },
            storageClassName: "standard",
          },
        },
      },
    },
  });

  new HttpRoute(chart, "trusted", "prometheus.bulia.dev").match(
    {
      name: "prometheus-operated",
      kind: "Service",
    },
    9090,
  );

  new VerticalPodAutoscaler(chart, prometheus);

  return chart;
};
