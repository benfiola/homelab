import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "https://kubernetes-sigs.github.io/metrics-server/metrics-server?version=3.14.0",
    {
      values: {
        args: [
          "--kubelet-insecure-tls",
          "--kubelet-preferred-address-types=InternalIP",
        ],
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "metrics-server" });
};

export const network: NetworkFunction = (n) => {
  const metricsServer = n.subject(
    "metrics-server",
    pod("metrics-server", "metrics-server"),
  );

  n.controlPlane.to(metricsServer, tcp(10250));
  n.host.to(metricsServer, tcp(10250));
  metricsServer.to(n.kubeApiServer, tcp(6443)).to(n.nodes, tcp(10250));
};
