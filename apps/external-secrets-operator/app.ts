import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

const tlsSecret = "bitwarden-tls-certs";

export const app: AppFunction = (h) => {
  h.helm("https://charts.external-secrets.io/external-secrets?version=2.14.0", {
    values: "values.yaml",
  });

  h.namespace();

  const server = "bitwarden-sdk-server";
  h.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: { name: server },
    spec: {
      dnsNames: [
        server,
        `${server}.${h.namespaceName}`,
        `${server}.${h.namespaceName}.svc`,
        `${server}.${h.namespaceName}.svc.cluster.local`,
      ],
      duration: "8760h",
      issuerRef: { kind: "ClusterIssuer", name: "self-signed" },
      secretName: tlsSecret,
    },
  });

  h.vpa({ kind: "Deployment", name: "external-secrets" });
  h.vpa({ kind: "Deployment", name: "external-secrets-cert-controller" });
  h.vpa({ kind: "Deployment", name: "external-secrets-webhook" });
  h.vpa({ kind: "Deployment", name: "bitwarden-sdk-server" });
};

export const network: NetworkFunction = (n) => {
  const namespace = "external-secrets-operator";
  const certController = n.subject(
    "external-secrets-cert-controller",
    pod("external-secrets-cert-controller", namespace),
  );
  const controller = n.subject(
    "external-secrets",
    pod("external-secrets", namespace),
  );
  const sdkServer = n.subject(
    "bitwarden-sdk-server",
    pod("bitwarden-sdk-server", namespace),
  );
  const webhook = n.subject(
    "external-secrets-webhook",
    pod("external-secrets-webhook", namespace),
  );

  n.host.to(certController, tcp(8081));
  certController.to(n.kubeApiServer, tcp(6443));

  controller.to(n.kubeApiServer, tcp(6443)).to(sdkServer, tcp(9998));

  n.host.to(sdkServer, tcp(9998));
  sdkServer
    .to(dns("api.bitwarden.com"), tcp(443))
    .to(dns("identity.bitwarden.com"), tcp(443));

  n.controlPlane.to(webhook, tcp(10250));
  n.host.to(webhook, tcp(8081));
  webhook.to(n.kubeApiServer, tcp(6443));
};
