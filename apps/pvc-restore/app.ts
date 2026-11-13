import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "oci://ghcr.io/benfiola/homelab-images/charts/pvc-restore?version=1.0.10",
    {
      values: {
        config: { cacheStorageClass: "standard" },
        metrics: {
          alerts: { enabled: true },
          dashboard: {
            annotations: {
              grafana_folder: h.app,
            },
            enabled: true,
          },
          podMonitor: { enabled: true },
        },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "pvc-restore" });
};

export const network: NetworkFunction = (n) => {
  const pvcRestore = n.subject(
    "pvc-restore",
    pod("pvc-restore", "pvc-restore"),
  );

  pvcRestore.to(n.kubeApiServer, tcp(6443));
  n.host.to(pvcRestore, tcp(8081));
  n.ref("prometheus").to(pvcRestore, tcp(8080));
};
