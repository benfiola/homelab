import type { AppFunction } from "../../tools/lib/app.ts";
import { container } from "../../tools/lib/k8s/edit.ts";

export const app: AppFunction = (h) => {
  h.manifest(
    "https://raw.githubusercontent.com/k8snetworkplumbingwg/multus-cni/refs/tags/v4.2.4/deployments/multus-daemonset-thick.yml",
    { namespace: true, labels: { "app.kubernetes.io/name": h.app } },
  );

  h.namespace({ privileged: true });
  h.vpa({ kind: "DaemonSet", name: "kube-multus-ds" }, { advisory: true });

  h.edit({ kind: "DaemonSet", name: "kube-multus-ds" }, (daemonSet) => {
    const multus = container(daemonSet, "kube-multus");
    multus.resources.requests.memory = "256Mi";
    multus.resources.limits = { memory: "400Mi" };

    // talos mounts the network namespaces at /var/run/netns, not /run/netns
    const volume = daemonSet.spec.template.spec.volumes.find(
      (v: any) => v.name === "host-run-netns",
    );
    volume.hostPath.path = "/var/run/netns";
    const mount = multus.volumeMounts.find(
      (m: any) => m.name === "host-run-netns",
    );
    mount.mountPath = "/var/run/netns";
  });
};
