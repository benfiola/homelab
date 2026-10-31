import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://grafana.github.io/helm-charts/alloy?version=1.4.0", {
    values: "values.yaml",
  });

  h.namespace();

  h.vpa({ kind: "DaemonSet", name: "alloy" });
};

export const network: NetworkFunction = (n) => {
  const alloy = n.subject("alloy", pod("alloy", "alloy"));

  alloy.to(n.kubeApiServer, tcp(6443)).to(n.ref("loki-gateway"), tcp(8080));
  n.host.to(alloy, tcp(12345));
};
