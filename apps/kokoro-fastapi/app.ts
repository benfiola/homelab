import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  // the image runs as appuser (1001), which owns /app
  const workload = h
    .deployment("kokoro-fastapi", {
      securityContext: { uid: 1001, gid: 1001 },
    })
    .addContainer("kokoro-fastapi", {
      image: "ghcr.io/remsky/kokoro-fastapi-gpu:v0.8.1-cu128",
      env: {
        USE_GPU: "true",
      },
      containerPorts: { http: 8880 },
      resources: {
        limits: { "nvidia.com/gpu": "1" },
        requests: { "nvidia.com/gpu": "1" },
      },
      readiness: {
        http: { path: "/health", port: 8880 },
        initialDelaySeconds: 30,
        periodSeconds: 30,
        timeoutSeconds: 5,
      },
      liveness: {
        http: { path: "/health", port: 8880 },
        initialDelaySeconds: 30,
        periodSeconds: 30,
        timeoutSeconds: 5,
      },
    });

  workload.service({ http: 8880 });
  h.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const kokoroFastapi = n.subject(
    "kokoro-fastapi",
    pod("kokoro-fastapi", "kokoro-fastapi"),
  );

  n.host.to(kokoroFastapi, tcp(8880));
};
