import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboard, prometheusRules } from "../../tools/lib/k8s/monitoring.ts";
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
        prometheusRules: {
          enabled: true,
          // replaced below: stale metric name
          disabled: { GarageHighRPCErrorRate: true },
        },
        resources: null,
        serviceMonitor: { enabled: true, honorLabels: true },
      },
    },
  );

  h.postRender((e) => {
    dashboard(e, "garage-operator-garage-dashboard", (d) =>
      d.replace("_duration{", "_duration_bucket{"),
    );
  });

  ns.add(
    ...prometheusRules("alert", [
      {
        name: "garage-rpc",
        rules: [
          {
            alert: "GarageHighRPCErrorRate",
            expr: 'sum by (instance) (rate(rpc_netapp_error_counter{job="garage"}[5m])) / sum by (instance) (rate(rpc_request_counter{job="garage"}[5m])) > 0.1',
            for: "10m",
            labels: { severity: "warning" },
            annotations: {
              summary: "High RPC error rate on {{ $labels.instance }}",
              description:
                "{{ $value | humanizePercentage }} of the RPC requests from {{ $labels.instance }} to other garage nodes are failing, and have been for 10 minutes.",
            },
          },
        ],
      },
    ]),
  );

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
