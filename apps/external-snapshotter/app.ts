import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.kustomize(
    "github.com/kubernetes-csi/external-snapshotter/deploy/kubernetes/snapshot-controller?ref=v8.7.0",
  );

  ns.vpa({ kind: "Deployment", name: "snapshot-controller" });

  const security = h.securityContext();
  h.postRender((e) => {
    const deployment = e.find({
      kind: "Deployment",
      name: "snapshot-controller",
    });
    const controller = e.container(deployment, "snapshot-controller");
    controller.image = "registry.k8s.io/sig-storage/snapshot-controller:v8.7.0";
    deployment.spec.template.spec.securityContext = security.pod;
    controller.securityContext = security.container;
  });
};

export const network: NetworkFunction = (n) => {
  const externalSnapshotter = n.subject(
    "external-snapshotter",
    pod("snapshot-controller", "external-snapshotter"),
  );

  externalSnapshotter.to(n.kubeApiServer, tcp(6443));
};
