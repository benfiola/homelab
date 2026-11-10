import type { AppFunction } from "../../tools/lib/app.ts";
import { appKustomization } from "../../tools/lib/k8s/flux.ts";
import {
  component,
  dns,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

// flux doesn't deploy this app: bootstrap.yaml creates the Kustomization that applies it
export const flux = false;

// a Kustomization for every app (see `export const flux` in tools/lib/k8s/flux.ts)
export const app: AppFunction = async (h) => {
  const ns = h.namespace({ name: "flux-system" });

  for (const name of h.apps) {
    const kustomization = appKustomization(name, await h.fluxDeclaration(name));
    if (kustomization) {
      ns.add(kustomization);
    }
  }

  for (const controller of [
    "helm-controller",
    "kustomize-controller",
    "notification-controller",
    "source-controller",
  ]) {
    ns.vpa({ kind: "Deployment", name: controller });
  }
};

export const network: NetworkFunction = (n) => {
  const fluxHelmController = n.subject(
    "flux-helm-controller",
    component("helm-controller", "flux-system"),
  );
  const fluxKustomizeController = n.subject(
    "flux-kustomize-controller",
    component("kustomize-controller", "flux-system"),
  );
  const fluxNotificationController = n.subject(
    "flux-notification-controller",
    component("notification-controller", "flux-system"),
  );
  const fluxSourceController = n.subject(
    "flux-source-controller",
    component("source-controller", "flux-system"),
  );

  fluxHelmController.to(n.kubeApiServer, tcp(6443));
  n.host.to(fluxHelmController, tcp(9440));
  fluxKustomizeController
    .to(n.kubeApiServer, tcp(6443))
    .to(fluxNotificationController, tcp(9090))
    .to(fluxSourceController, tcp(9090));
  n.host.to(fluxKustomizeController, tcp(9440));
  fluxNotificationController.to(n.kubeApiServer, tcp(6443));
  n.host.to(fluxNotificationController, tcp(9440));
  fluxSourceController
    .to(n.kubeApiServer, tcp(6443))
    .to(fluxNotificationController, tcp(9090))
    .to(dns("github.com"), tcp(22));
  n.host.to(fluxSourceController, tcp(9090, 9440));
};
