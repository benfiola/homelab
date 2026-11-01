import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts/csi-driver-nfs?version=4.13.6",
    { values: "values.yaml" },
  );

  h.namespace({ privileged: true });

  h.vpa({ kind: "Deployment", name: "csi-nfs-controller" });
};
