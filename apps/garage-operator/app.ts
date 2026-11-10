import type { AppFunction } from "../../tools/lib/app.ts";
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
      values: { resources: null },
    },
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
};
