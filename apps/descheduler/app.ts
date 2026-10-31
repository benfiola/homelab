import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://kubernetes-sigs.github.io/descheduler/descheduler?version=0.36.0",
    { values: "values.yaml" },
  );

  h.namespace();

  h.vpa({ kind: "Deployment", name: "descheduler" });
};

export const network: NetworkFunction = (n) => {
  const descheduler = n.subject(
    "descheduler",
    pod("descheduler", "descheduler"),
  );

  descheduler.to(n.kubeApiServer, tcp(6443));
  n.host.to(descheduler, tcp(10258));
};
