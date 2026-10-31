import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "oci://ghcr.io/benfiola/homelab-images/charts/pvc-restore?version=1.0.3",
    { values: "values.yaml" },
  );

  h.namespace();

  h.vpa({ kind: "Deployment", name: "pvc-restore" });
};

export const network: NetworkFunction = (n) => {
  const pvcRestore = n.subject(
    "pvc-restore",
    pod("pvc-restore", "pvc-restore"),
  );

  pvcRestore.to(n.kubeApiServer, tcp(6443));
  n.host.to(pvcRestore, tcp(8081));
};
