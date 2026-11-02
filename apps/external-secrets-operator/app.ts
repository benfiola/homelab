import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";
import {
  blobSecret,
  credentialsSecret,
  esoNamespace,
  pusherServiceAccount,
} from "../../tools/lib/k8s/secrets.ts";
import {
  appsSecret,
  organization,
  project,
} from "../../tools/lib/secrets/bitwarden.ts";

const tlsSecret = "bitwarden-tls-certs";

export const app: AppFunction = (h) => {
  // the helpers that push Secrets put their objects here
  h.namespaceName = esoNamespace;

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

  const sdkServer = h
    .deployment(server, {
      volumes: {
        certs: {
          secret: tlsSecret,
          items: [
            { key: "tls.crt", path: "cert.pem" },
            { key: "tls.key", path: "key.pem" },
          ],
        },
      },
    })
    .addContainer(server, {
      image: "ghcr.io/external-secrets/bitwarden-sdk-server:v0.8.1",
      containerPorts: { https: 9998 },
      liveness: { http: { path: "/live", port: "https", scheme: "HTTPS" } },
      readiness: { http: { path: "/ready", port: "https", scheme: "HTTPS" } },
      volumeMounts: { certs: "/certs" },
    });
  sdkServer.service({ https: 9998 });

  h.add({
    apiVersion: "external-secrets.io/v1",
    kind: "SecretStore",
    metadata: { name: "bitwarden" },
    spec: {
      provider: {
        bitwardensecretsmanager: {
          apiURL: "https://api.bitwarden.com",
          auth: {
            secretRef: {
              credentials: { key: "token", name: credentialsSecret },
            },
          },
          bitwardenServerSDKURL: `https://${server}.${h.namespaceName}.svc.cluster.local:9998`,
          caProvider: { key: "ca.crt", name: tlsSecret, type: "Secret" },
          identityURL: "https://identity.bitwarden.com",
          organizationID: organization,
          projectID: project,
        },
      },
    },
  });

  h.add({
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: blobSecret },
    spec: {
      data: [{ remoteRef: { key: appsSecret }, secretKey: blobSecret }],
      refreshInterval: "1h",
      secretStoreRef: { kind: "SecretStore", name: "bitwarden" },
      target: { name: blobSecret },
    },
  });

  h.add(
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: pusherServiceAccount },
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRole",
      metadata: { name: pusherServiceAccount },
      rules: [
        {
          apiGroups: [""],
          resources: ["secrets"],
          verbs: [
            "create",
            "delete",
            "get",
            "list",
            "patch",
            "update",
            "watch",
          ],
        },
        {
          apiGroups: ["authorization.k8s.io"],
          resources: ["selfsubjectrulesreviews"],
          verbs: ["create"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "ClusterRoleBinding",
      metadata: { name: pusherServiceAccount },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: pusherServiceAccount,
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: pusherServiceAccount,
          namespace: h.namespaceName,
        },
      ],
    },
  );

  h.vpa({ kind: "Deployment", name: "external-secrets" });
  h.vpa({ kind: "Deployment", name: "external-secrets-cert-controller" });
  h.vpa({ kind: "Deployment", name: "external-secrets-webhook" });
  h.vpa(sdkServer);
};

export const network: NetworkFunction = (n) => {
  const namespace = esoNamespace;
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
