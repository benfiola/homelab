import type { AppFunction } from "../../tools/lib/app.ts";
import { container } from "../../tools/lib/k8s/edit.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.kustomize(
    "github.com/kubernetes-csi/external-snapshotter/deploy/kubernetes/snapshot-controller?ref=v8.7.0",
    {
      namespace: true,
    },
  );

  h.namespace();

  h.vpa({ kind: "Deployment", name: "snapshot-controller" });

  h.edit({ kind: "Deployment", name: "snapshot-controller" }, (deployment) => {
    const controller = container(deployment, "snapshot-controller");
    controller.image = "registry.k8s.io/sig-storage/snapshot-controller:v8.7.0";
    deployment.spec.template.spec.securityContext = {
      fsGroup: 65534,
      runAsNonRoot: true,
      runAsUser: 65534,
      runAsGroup: 65534,
      seccompProfile: { type: "RuntimeDefault" },
    };
    controller.securityContext = {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"], add: [] },
      runAsNonRoot: true,
      runAsUser: 65534,
      runAsGroup: 65534,
    };
  });
};

export const network: NetworkFunction = (n) => {
  const externalSnapshotter = n.subject(
    "external-snapshotter",
    pod("snapshot-controller", "external-snapshotter"),
  );

  externalSnapshotter.to(n.kubeApiServer, tcp(6443));
};
