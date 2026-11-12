import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm(
    "https://intel.github.io/helm-charts/intel-device-plugins-operator?version=0.37.1",
    {
      values: {
        resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: null },
      },
    },
  );

  ns.vpa({ kind: "Deployment", name: "inteldeviceplugins-controller-manager" });

  // the operator's pods are selected by app name, like every other app's
  h.postRender((e) => {
    const deployment = e.find({
      kind: "Deployment",
      name: "inteldeviceplugins-controller-manager",
    });
    deployment.spec.template.metadata.labels["app.kubernetes.io/name"] = h.app;

    const manager = e.container(deployment, "manager");
    e.replace(manager.args, "--metrics-secure", "--metrics-secure=false");
    manager.ports.push({ name: "metrics", containerPort: 8443 });
  });

  ns.podMonitor(
    "intel-device-plugins-operator",
    { "app.kubernetes.io/name": h.app },
    "metrics",
  );
};

export const network: NetworkFunction = (n) => {
  const intelDevicePluginsOperator = n.subject(
    "intel-device-plugins-operator",
    pod("intel-device-plugins-operator", "intel-device-plugins-operator"),
  );

  intelDevicePluginsOperator.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.to(intelDevicePluginsOperator, tcp(9443));
  n.host.to(intelDevicePluginsOperator, tcp(8081, 9443));
  n.ref("prometheus").to(intelDevicePluginsOperator, tcp(8443));
};
