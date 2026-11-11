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
  const ns = h.namespace();

  const security = h.securityContext();

  await ns.helm("https://grafana.github.io/helm-charts/alloy?version=1.15.0", {
    values: {
      serviceMonitor: { enabled: true },
      alloy: {
        configMap: {
          content: `discovery.kubernetes "pod" {
  role = "pod"
}

discovery.relabel "pod_logs" {
  targets = discovery.kubernetes.pod.targets

  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    action = "replace"
    target_label = "namespace"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    action = "replace"
    target_label = "pod"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    action = "replace"
    target_label = "container"
  }
}

loki.source.kubernetes "pod_logs" {
  targets    = discovery.relabel.pod_logs.output
  forward_to = [loki.process.pod_logs.receiver]
}

loki.process "pod_logs" {
  forward_to = [loki.relabel.pod_logs.receiver]
}

loki.relabel "pod_logs" {
  forward_to = [loki.write.default.receiver]

  rule {
    action = "replace"
    replacement = "cluster.fiola.dev"
    target_label = "cluster"
  }

  rule {
    action = "replace"
    source_labels = ["namespace", "container"]
    separator = "/"
    target_label = "job"
  }
}

loki.write "default" {
  endpoint {
    url = "http://loki-gateway.loki.svc/loki/api/v1/push"
  }
}
`,
        },
        enableReporting: false,
        livenessProbe: {
          httpGet: { path: "/-/healthy", port: 12345 },
          timeoutSeconds: 5,
          failureThreshold: 6,
        },
        securityContext: security.container,
      },
      configReloader: {
        securityContext: security.container,
      },
      crds: { enable: false },
      global: {
        podSecurityContext: security.pod,
      },
    },
  });

  const mixin = await ns.jsonnet("main.jsonnet");
  ns.add(
    ...prometheusRules("alert", mixin.alerts),
    ...dashboardConfigMaps(h.app, mixin.dashboards),
  );

  ns.vpa({ kind: "DaemonSet", name: "alloy" });
};

export const network: NetworkFunction = (n) => {
  const alloy = n.subject("alloy", pod("alloy", "alloy"));

  alloy.to(n.kubeApiServer, tcp(6443)).to(n.ref("loki-gateway"), tcp(8080));
  n.host.to(alloy, tcp(12345));
  n.ref("prometheus").to(alloy, tcp(12345));
};
