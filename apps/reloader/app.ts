import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://stakater.github.io/stakater-charts/reloader?version=2.2.19", {
    values: {
      reloader: {
        autoReloadAll: true,
        deployment: {
          securityContext: {
            fsGroup: 65534,
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containerSecurityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"], add: [] },
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
          },
        },
        reloadStrategy: "annotations",
      },
    },
  });

  h.namespace();

  h.vpa({ kind: "Deployment", name: "reloader-reloader" });
};

export const network: NetworkFunction = (n) => {
  const reloader = n.subject("reloader", pod("reloader", "reloader"));

  reloader.to(n.kubeApiServer, tcp(6443));
  n.host.to(reloader, tcp(9090));
};
