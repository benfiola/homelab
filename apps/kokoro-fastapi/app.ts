import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  // the image runs as appuser (1001), which owns /app
  const workload = ns
    .deployment("kokoro-fastapi", {
      securityContext: { uid: 1001, gid: 1001 },
    })
    .addContainer("kokoro-fastapi", {
      image: "ghcr.io/remsky/kokoro-fastapi-gpu:v0.10.0-cu128",
      env: {
        USE_GPU: "true",
      },
      containerPorts: { http: 8880 },
      resources: {
        limits: { "nvidia.com/gpu": "1" },
        requests: { "nvidia.com/gpu": "1" },
      },
      ...h.probes({ http: { path: "/health", port: 8880 } }),
    });

  workload.service({ http: 8880 });
  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const kokoroFastapi = n.subject(
    "kokoro-fastapi",
    pod("kokoro-fastapi", "kokoro-fastapi"),
  );

  n.host.to(kokoroFastapi, tcp(8880));
};
