import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.kustomize(
    "https://raw.githubusercontent.com/k8snetworkplumbingwg/multus-cni/refs/tags/v4.3.2/deployments/multus-daemonset-thick.yml",
    { labels: { "app.kubernetes.io/name": h.app } },
  );

  h.namespace({ privileged: true });
  h.vpa({ kind: "DaemonSet", name: "kube-multus-ds" }, { advisory: true });

  h.postRender((e) => {
    const daemonSet = e.find({ kind: "DaemonSet", name: "kube-multus-ds" });
    const multus = e.container(daemonSet, "kube-multus");
    multus.resources.requests.memory = "256Mi";
    multus.resources.limits = { memory: "400Mi" };

    // talos mounts the network namespaces at /var/run/netns, not /run/netns
    const volume = e.item(
      daemonSet.spec.template.spec.volumes,
      (v: any) => v.name === "host-run-netns",
      "volume host-run-netns",
    );
    volume.hostPath.path = "/var/run/netns";
    const mount = e.item(
      multus.volumeMounts,
      (m: any) => m.name === "host-run-netns",
      "volume mount host-run-netns",
    );
    mount.mountPath = "/var/run/netns";
  });
};
