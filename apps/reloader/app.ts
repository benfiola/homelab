import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://stakater.github.io/stakater-charts/reloader?version=2.2.14", {
    values: "values.yaml",
  });

  h.namespace();

  h.vpa({ kind: "Deployment", name: "reloader-reloader" });
};

export const network: NetworkFunction = (n) => {
  const reloader = n.subject("reloader", pod("reloader", "reloader"));

  reloader.to(n.kubeApiServer, tcp(6443));
  n.host.to(reloader, tcp(9090));
};
