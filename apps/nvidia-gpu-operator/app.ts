import type { AppFunction } from "../../tools/lib/app.ts";
import {
  appLabel,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://helm.ngc.nvidia.com/nvidia/gpu-operator?version=v26.3.3", {
    release: "nvidia-gpu-operator",
    values: "values.yaml",
  });

  h.namespace({ privileged: true });

  h.configMap("user-config", {
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

  h.vpa({ kind: "Deployment", name: "gpu-operator" });
};

export const network: NetworkFunction = (n) => {
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
  const nvidiaOperatorValidator = n.subject(
    "nvidia-operator-validator",
    appLabel("nvidia-operator-validator", "nvidia-gpu-operator"),
  );

  nvidiaDevicePlugin.to(n.kubeApiServer, tcp(6443));
  nvidiaGpuFeatureDiscovery.to(n.kubeApiServer, tcp(6443));
  nvidiaGpuOperator.to(n.kubeApiServer, tcp(6443));
  n.host.to(nvidiaGpuOperator, tcp(8081));
  nvidiaOperatorValidator.to(n.kubeApiServer, tcp(6443));
};
