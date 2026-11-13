import type { AppFunction } from "../../tools/lib/app.ts";
import { dashboardConfigMaps } from "../../tools/lib/k8s/monitoring.ts";
import {
  appLabel,
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm(
    "https://helm.ngc.nvidia.com/nvidia/gpu-operator?version=v26.7.2",
    {
      release: "nvidia-gpu-operator",
      values: {
        dcgmExporter: { serviceMonitor: { enabled: true } },
        devicePlugin: { config: { name: "user-config", default: "any" } },
        driver: { enabled: false },
        hostPaths: { driverInstallDir: "/usr/local" },
        migManager: { enabled: false },
        nfd: { enabled: false },
        nodeStatusExporter: { enabled: false },
        operator: { resources: null },
        toolkit: { enabled: false },
      },
    },
  );

  ns.configMap("user-config", {
    any: `"version": "v1"
"flags":
  "migStrategy": "none"
"sharing":
  "timeSlicing":
    "resources":
      - "name": "nvidia.com/gpu"
        "replicas": 127
`,
  });

  const mixin = await ns.jsonnet("main.jsonnet");
  ns.add(...dashboardConfigMaps(h.app, mixin.dashboards));

  ns.vpa({ kind: "Deployment", name: "gpu-operator" });
  ns.vpa({ kind: "DaemonSet", name: "nvidia-dcgm-exporter" });

  h.postRender((e) => {
    const job = e.find({ kind: "Job", name: "gpu-operator-upgrade-crd" });
    for (const meta of [job.metadata, job.spec.template.metadata]) {
      meta.labels["app.kubernetes.io/component"] = "gpu-operator-upgrade-crd";
    }
  });
};

export const network: NetworkFunction = (n) => {
  const nvidiaDcgmExporter = n.subject(
    "nvidia-dcgm-exporter",
    appLabel("nvidia-dcgm-exporter", "nvidia-gpu-operator"),
  );
  const nvidiaDevicePlugin = n.subject(
    "nvidia-device-plugin",
    appLabel("nvidia-device-plugin-daemonset", "nvidia-gpu-operator"),
  );
  const nvidiaGpuFeatureDiscovery = n.subject(
    "nvidia-gpu-feature-discovery",
    appLabel("gpu-feature-discovery", "nvidia-gpu-operator"),
  );
  const nvidiaGpuOperator = n.subject(
    "nvidia-gpu-operator",
    appLabel("gpu-operator", "nvidia-gpu-operator"),
  );
  const upgradeCrd = n.subject(
    "nvidia-gpu-operator-upgrade-crd",
    component("gpu-operator-upgrade-crd", "nvidia-gpu-operator"),
  );
  const nvidiaOperatorValidator = n.subject(
    "nvidia-operator-validator",
    appLabel("nvidia-operator-validator", "nvidia-gpu-operator"),
  );

  n.host.to(nvidiaDcgmExporter, tcp(9400));
  n.ref("prometheus").to(nvidiaDcgmExporter, tcp(9400));

  nvidiaDevicePlugin.to(n.kubeApiServer, tcp(6443));

  nvidiaGpuFeatureDiscovery.to(n.kubeApiServer, tcp(6443));

  nvidiaGpuOperator.to(n.kubeApiServer, tcp(6443));
  n.host.to(nvidiaGpuOperator, tcp(8081));
  n.ref("prometheus").to(nvidiaGpuOperator, tcp(8080));

  upgradeCrd.to(n.kubeApiServer, tcp(6443));

  nvidiaOperatorValidator.to(n.kubeApiServer, tcp(6443));
};
