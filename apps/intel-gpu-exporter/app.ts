import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace({ privileged: true });

  const workload = ns
    .daemonSet("intel-gpu-exporter", {
      nodeSelector: { "intel.feature.node.kubernetes.io/gpu": "true" },
      securityContext: { uid: 0, gid: 0, caps: ["PERFMON"] },
    })
    .addContainer("intel-gpu-exporter", {
      image:
        "ghcr.io/onedr0p/intel-gpu-exporter@sha256:90a95483bf5d3752f4db2ab2e1663f19bba307fd832bf53557cbdc38c3701f84",
      containerPorts: { metrics: 8080 },
      resources: {
        limits: { "gpu.intel.com/i915": "1" },
        requests: { "gpu.intel.com/i915": "1" },
      },
      ...h.probes({ tcp: { port: 8080 } }),
    });

  workload.podMonitor("metrics");

  ns.configMap("dashboard--intel-gpu-json", h.files("intel-gpu.json"), {
    labels: { grafana_dashboard: "1" },
    annotations: { grafana_folder: h.app },
  });

  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const exporter = n.subject(
    "intel-gpu-exporter",
    pod("intel-gpu-exporter", "intel-gpu-exporter"),
  );

  n.host.to(exporter, tcp(8080));
  n.ref("prometheus").to(exporter, tcp(8080));
};
