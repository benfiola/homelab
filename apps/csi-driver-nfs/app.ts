import type { AppFunction } from "../../tools/lib/app.ts";
import {
  cidrs,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm(
    "https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts/csi-driver-nfs?version=4.13.6",
    {
      values: {
        controller: {
          resources: {
            csiProvisioner: { limits: null, requests: null },
            csiResizer: { limits: null, requests: null },
            livenessProbe: { limits: null, requests: null },
            nfs: { limits: null, requests: null },
          },
        },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "csi-nfs-controller" });
};

export const network: NetworkFunction = (n) => {
  n.nodes.to(cidrs("192.168.32.7/32"), tcp(111, 2049));
};
