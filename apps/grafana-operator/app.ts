import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("oci://ghcr.io/grafana/helm-charts/grafana-operator?version=5.25.0", {
    values: {
      podSecurityContext: {
        fsGroup: 65534,
        runAsNonRoot: true,
        runAsUser: 65534,
        runAsGroup: 65534,
        seccompProfile: { type: "RuntimeDefault" },
      },
      securityContext: {
        allowPrivilegeEscalation: false,
        capabilities: { drop: ["ALL"], add: [] },
        runAsNonRoot: true,
        runAsUser: 65534,
        runAsGroup: 65534,
      },
    },
  });

  h.namespace();

  h.vpa({ kind: "Deployment", name: "grafana-operator" });
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
};
