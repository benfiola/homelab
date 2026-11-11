import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  const security = h.securityContext();

  await ns.helm(
    "oci://ghcr.io/grafana/helm-charts/grafana-operator?version=5.25.0",
    {
      values: {
        dashboard: {
          enabled: true,
          annotations: { grafana_folder: h.app },
          labels: { grafana_dashboard: "1" },
        },
        podSecurityContext: security.pod,
        securityContext: security.container,
        serviceMonitor: { enabled: true },
      },
    },
  );

  h.postRender((e) => {
    const dashboard = e.find({
      kind: "ConfigMap",
      name: "grafana-operator-dashboard",
    });
    const from = 'job=\\"apiserver\\"';
    const to = 'job=\\"kube-apiserver\\"';
    const data = dashboard.data["grafana-operator.json"];
    if (!data.includes(from)) {
      throw new Error(`dashboard no longer contains ${from}`);
    }
    dashboard.data["grafana-operator.json"] = data.replaceAll(from, to);
  });

  ns.vpa({ kind: "Deployment", name: "grafana-operator" });
};

export const network: NetworkFunction = (n) => {
  const grafanaOperator = n.subject(
    "grafana-operator",
    component("operator", "grafana-operator"),
  );

  grafanaOperator
    .to(n.kubeApiServer, tcp(6443))
    .to(n.ref("grafana"), tcp(3000));
  n.host.to(grafanaOperator, tcp(8081));
  n.ref("prometheus").to(grafanaOperator, tcp(9090));
};
