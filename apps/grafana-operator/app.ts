import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboard } from "../../tools/lib/k8s/monitoring.ts";
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
    dashboard(e, "grafana-operator-dashboard", (d) =>
      d
        .replace('job=\\"apiserver\\"', 'job=\\"kube-apiserver\\"')
        .replace("monitoring-system", "grafana-operator"),
    );
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
