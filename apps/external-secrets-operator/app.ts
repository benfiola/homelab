import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

// the secret the chart mounts into the bitwarden sdk server, which only speaks https
const tlsSecret = "bitwarden-tls-certs";

export const app: AppFunction = (h) => {
  h.helm("https://charts.external-secrets.io/external-secrets?version=2.14.0", {
    values: "values.yaml",
  });

  h.namespace();

  // the sdk server's certificate: a ca of our own, which signs the server's certificate. the ca is
  // what external secrets trusts (the ca.crt of the server's secret)
  const server = `bitwarden-sdk-server`;
  h.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: { name: `${server}-ca` },
    spec: {
      commonName: `${server}-ca`,
      duration: "87600h",
      isCA: true,
      issuerRef: { kind: "ClusterIssuer", name: "self-signed" },
      secretName: `${server}-ca`,
    },
  });
  h.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Issuer",
    metadata: { name: server },
    spec: { ca: { secretName: `${server}-ca` } },
  });
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
      issuerRef: { kind: "Issuer", name: server },
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

  certController.to(n.kubeApiServer, tcp(6443));
  controller.to(n.kubeApiServer, tcp(6443)).to(sdkServer, tcp(9998));
  sdkServer
    .to(dns("api.bitwarden.com"), tcp(443))
    .to(dns("identity.bitwarden.com"), tcp(443));
  webhook.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.to(webhook, tcp(10250));
  // health probes
  n.host.to(certController, tcp(8081));
  n.host.to(sdkServer, tcp(9998));
  n.host.to(webhook, tcp(8081));
};
