import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  dns,
  tcp,
  udp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm("oci://quay.io/jetstack/charts/cert-manager?version=v1.21.3", {
    values: {
      config: {
        apiVersion: "controller.config.cert-manager.io/v1alpha1",
        kind: "ControllerConfiguration",
        featureGates: { ListenerSets: true },
        gatewayAPI: { enabled: true, enableListenerSet: true },
      },
      crds: { enabled: true, keep: false },
      prometheus: { servicemonitor: { enabled: true } },
    },
  });

  ns.add({
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
      name: "cloudflare",
    },
    spec: {
      acme: {
        email: "benfiola@protonmail.com",
        privateKeySecretRef: {
          name: "acme-identity",
        },
        server: "https://acme-v02.api.letsencrypt.org/directory",
        solvers: [
          {
            dns01: {
              cloudflare: {
                apiTokenSecretRef: {
                  key: "cloudflare-api-token",
                  name: "secrets",
                },
              },
            },
          },
        ],
      },
    },
  });

  ns.add({
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
      name: "self-signed",
    },
    spec: {
      selfSigned: {},
    },
  });

  ns.secrets("secrets", ["cloudflare-api-token"]);

  ns.vpa({ kind: "Deployment", name: "cert-manager" });

  ns.vpa({ kind: "Deployment", name: "cert-manager-cainjector" });

  ns.vpa({ kind: "Deployment", name: "cert-manager-webhook" });
};

export const network: NetworkFunction = (n) => {
  const certManagerCainjector = n.subject(
    "cert-manager-cainjector",
    component("cainjector", "cert-manager"),
  );
  const certManagerController = n.subject(
    "cert-manager-controller",
    component("controller", "cert-manager"),
  );
  const certManagerStartupapicheck = n.subject(
    "cert-manager-startupapicheck",
    component("startupapicheck", "cert-manager"),
  );
  const certManagerWebhook = n.subject(
    "cert-manager-webhook",
    component("webhook", "cert-manager"),
  );

  certManagerCainjector.to(n.kubeApiServer, tcp(6443));
  n.ref("prometheus").to(certManagerCainjector, tcp(9402));

  certManagerController
    .to(n.kubeApiServer, tcp(6443))
    .to(dns("api.cloudflare.com"), tcp(443))
    .to(dns("*.ns.cloudflare.com"), udp(53))
    .to(dns("*.api.letsencrypt.org"), tcp(443));
  n.host.to(certManagerController, tcp(9403));
  n.ref("prometheus").to(certManagerController, tcp(9402));

  certManagerStartupapicheck.to(n.kubeApiServer, tcp(6443));

  certManagerWebhook.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.to(certManagerWebhook, tcp(10250));
  n.host.to(certManagerWebhook, tcp(6080));
  n.ref("prometheus").to(certManagerWebhook, tcp(9402));
};
