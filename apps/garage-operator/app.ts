import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboard } from "../../tools/lib/k8s/monitoring.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "oci://ghcr.io/rajsinghtech/charts/garage-operator?version=0.9.0",
    {
      values: {
        grafanaDashboard: {
          enabled: true,
          annotations: { grafana_folder: h.app },
        },
        resources: null,
        serviceMonitor: { enabled: true },
      },
    },
  );

  h.postRender((e) => {
    dashboard(e, "garage-operator-garage-dashboard", (d) =>
      d.replace(/rate\(([a-z0-9_]+_duration)\{/, "rate($1_bucket{"),
    );
  });

  ns.vpa({ kind: "Deployment", name: "garage-operator" });
};

export const network: NetworkFunction = (n) => {
  const garageOperator = n.subject(
    "garage-operator",
    pod("garage-operator", "garage-operator"),
  );

  garageOperator.to(n.kubeApiServer, tcp(6443)).to(n.ref("garage"), tcp(3903));
  n.controlPlane.to(garageOperator, tcp(9443));
  n.host.to(garageOperator, tcp(8081));
  n.ref("prometheus").to(garageOperator, tcp(8443));
};
