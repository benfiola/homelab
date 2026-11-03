import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const securityContext = {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"], add: [] },
    runAsNonRoot: true,
    runAsUser: 65534,
    runAsGroup: 65534,
  };

  h.helm("https://grafana.github.io/helm-charts/alloy?version=1.15.0", {
    values: {
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
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki-gateway.loki.svc/loki/api/v1/push"
  }
}
`,
        },
        enableReporting: false,
        securityContext,
      },
      configReloader: {
        securityContext,
      },
      crds: { enable: false },
      global: {
        podSecurityContext: {
          fsGroup: 65534,
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
          seccompProfile: { type: "RuntimeDefault" },
        },
      },
    },
  });

  h.namespace();

  h.vpa({ kind: "DaemonSet", name: "alloy" });
};

export const network: NetworkFunction = (n) => {
  const alloy = n.subject("alloy", pod("alloy", "alloy"));

  alloy.to(n.kubeApiServer, tcp(6443)).to(n.ref("loki-gateway"), tcp(8080));
  n.host.to(alloy, tcp(12345));
};
