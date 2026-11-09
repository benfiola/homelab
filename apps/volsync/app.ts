import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "https://backube.github.io/helm-charts/volsync?version=0.17.0",
    {
      values: {
        "kube-rbac-proxy-resources": {
          requests: { cpu: "5m", memory: "64Mi" },
          limits: null,
        },
        resources: { requests: { cpu: "100m", memory: "64Mi" }, limits: null },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "volsync" });
};

export const network: NetworkFunction = (n) => {
  const volsync = n.subject("volsync", pod("volsync", "volsync"));
  const volsyncMover = n.subject("volsync-mover", pod("volsync-mover", "*"));

  volsync.to(n.kubeApiServer, tcp(6443));
  n.host.to(volsync, tcp(8081));
  volsyncMover
    .to(dns("*.backblazeb2.com"), tcp(443))
    .to(dns("*.backblaze.com"), tcp(443));
};
