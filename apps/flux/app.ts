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

  const dashboards =
    "https://raw.githubusercontent.com/fluxcd/flux2-monitoring-example/7ab65dc8b90f7a6751d88f18bbb4e1bee33bf334/monitoring/configs/dashboards";
  for (const file of ["cluster", "control-plane"]) {
    ns.configMap(
      `dashboard--${file}`,
      { [`${file}.json`]: await h.fetch(`${dashboards}/${file}.json`) },
      {
        labels: { grafana_dashboard: "1" },
        annotations: { grafana_folder: h.app },
      },
    );
  }

  ns.podMonitor("flux", { "app.kubernetes.io/part-of": "flux" }, "http-prom");

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
  const helmController = n.subject(
    "flux-helm-controller",
    component("helm-controller", "flux-system"),
  );
  const kustomizeController = n.subject(
    "flux-kustomize-controller",
    component("kustomize-controller", "flux-system"),
  );
  const notificationController = n.subject(
    "flux-notification-controller",
    component("notification-controller", "flux-system"),
  );
  const sourceController = n.subject(
    "flux-source-controller",
    component("source-controller", "flux-system"),
  );

  helmController.to(n.kubeApiServer, tcp(6443));
  n.host.to(helmController, tcp(9440));
  n.ref("prometheus").to(helmController, tcp(8080));

  kustomizeController
    .to(n.kubeApiServer, tcp(6443))
    .to(notificationController, tcp(9090))
    .to(sourceController, tcp(9090));
  n.host.to(kustomizeController, tcp(9440));
  n.ref("prometheus").to(kustomizeController, tcp(8080));

  notificationController.to(n.kubeApiServer, tcp(6443));
  n.host.to(notificationController, tcp(9440));
  n.ref("prometheus").to(notificationController, tcp(8080));

  sourceController
    .to(n.kubeApiServer, tcp(6443))
    .to(notificationController, tcp(9090))
    .to(dns("github.com"), tcp(22));
  n.host.to(sourceController, tcp(9090, 9440));
  n.ref("prometheus").to(sourceController, tcp(8080));
};
