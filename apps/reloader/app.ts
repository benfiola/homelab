import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  const security = h.securityContext();

  await ns.helm(
    "https://stakater.github.io/stakater-charts/reloader?version=2.2.20",
    {
      values: {
        reloader: {
          autoReloadAll: true,
          deployment: {
            securityContext: security.pod,
            containerSecurityContext: security.container,
          },
          podMonitor: { enabled: true },
          reloadStrategy: "annotations",
        },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "reloader-reloader" });
};

export const network: NetworkFunction = (n) => {
  const reloader = n.subject("reloader", pod("reloader", "reloader"));

  reloader.to(n.kubeApiServer, tcp(6443));
  n.host.to(reloader, tcp(9090));
  n.ref("prometheus").to(reloader, tcp(9090));
};
