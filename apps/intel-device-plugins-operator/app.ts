import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://intel.github.io/helm-charts/intel-device-plugins-operator?version=0.37.1",
    {
      values: {
        resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: null },
      },
    },
  );

  h.namespace({ privileged: true });

  h.vpa({ kind: "Deployment", name: "inteldeviceplugins-controller-manager" });

  // the operator's pods are selected by app name, like every other app's
  h.postRender((e) => {
    const deployment = e.find({
      kind: "Deployment",
      name: "inteldeviceplugins-controller-manager",
    });
    deployment.spec.template.metadata.labels["app.kubernetes.io/name"] = h.app;
  });
};

export const network: NetworkFunction = (n) => {
  const intelDevicePluginsOperator = n.subject(
    "intel-device-plugins-operator",
    pod("intel-device-plugins-operator", "intel-device-plugins-operator"),
  );

  n.controlPlane.to(intelDevicePluginsOperator, tcp(9443));
  intelDevicePluginsOperator.to(n.kubeApiServer, tcp(6443));
  n.host.to(intelDevicePluginsOperator, tcp(8081, 9443));
};
