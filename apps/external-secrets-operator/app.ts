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
  generatedObjects,
  mergedExternalSecret,
  pusherServiceAccount,
  pushStore,
} from "../../tools/lib/k8s/secrets.ts";
import {
  appsSecret,
  organization,
  project,
} from "../../tools/lib/secrets/bitwarden.ts";

const tlsSecret = "bitwarden-tls-certs";

export const app: AppFunction = async (h) => {
  // the helpers that push Secrets put their objects here
  const ns = h.namespace({ name: esoNamespace });

  const security = h.securityContext();

  await ns.helm(
    "https://charts.external-secrets.io/external-secrets?version=2.14.0",
    {
      values: {
        // deployed by the app itself (see below): the chart's lags upstream
        "bitwarden-sdk-server": { enabled: false },
        certController: {
          livenessProbe: { enabled: true },
          podSecurityContext: security.pod,
          securityContext: security.container,
        },
        grafanaDashboard: {
          enabled: true,
          annotations: { grafana_folder: h.app },
        },
        livenessProbe: { enabled: true },
        podSecurityContext: security.pod,
        readinessProbe: { enabled: true },
        securityContext: security.container,
        serviceMonitor: { enabled: true },
        webhook: {
          livenessProbe: { enabled: true },
          podSecurityContext: security.pod,
          securityContext: security.container,
        },
      },
    },
  );

  const server = "bitwarden-sdk-server";
  ns.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: { name: server },
    spec: {
      dnsNames: [
        server,
        `${server}.${ns.name}`,
        `${server}.${ns.name}.svc`,
        `${server}.${ns.name}.svc.cluster.local`,
      ],
      duration: "8760h",
      issuerRef: { kind: "ClusterIssuer", name: "self-signed" },
      secretName: tlsSecret,
    },
  });

  const sdkServer = ns
    .deployment(server, {
      volumes: {
        certs: {
          secret: tlsSecret,
          items: [
            { key: "tls.crt", path: "cert.pem" },
            { key: "tls.key", path: "key.pem" },
          ],
        },
        state: { memory: {} },
      },
    })
    .addContainer(server, {
      image: "ghcr.io/external-secrets/bitwarden-sdk-server:v0.8.1",
      containerPorts: { https: 9998 },
      ...h.probes(
        { http: { path: "/live", port: "https", scheme: "HTTPS" } },
        {
          ready: { http: { path: "/ready", port: "https", scheme: "HTTPS" } },
          startup: false,
        },
      ),
      args: ["--state-path=/state/session"],
      volumeMounts: { certs: "/certs", state: "/state" },
    });
  sdkServer.service({ https: 9998 });

  ns.add({
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
          bitwardenServerSDKURL: `https://${server}.${ns.name}.svc.cluster.local:9998`,
          caProvider: { key: "ca.crt", name: tlsSecret, type: "Secret" },
          identityURL: "https://identity.bitwarden.com",
          organizationID: organization,
          projectID: project,
        },
      },
    },
  });

  ns.add({
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: blobSecret },
    spec: {
      data: [{ remoteRef: { key: appsSecret }, secretKey: blobSecret }],
      refreshInterval: "1m",
      secretStoreRef: { kind: "SecretStore", name: "bitwarden" },
      target: { name: blobSecret },
    },
  });

  // this store lets the merged Secret read this namespace
  ns.add(
    pushStore(esoNamespace),
    ...generatedObjects(),
    mergedExternalSecret(),
  );

  ns.add(
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
          namespace: ns.name,
        },
      ],
    },
  );

  ns.vpa({ kind: "Deployment", name: "external-secrets" });
  ns.vpa({ kind: "Deployment", name: "external-secrets-cert-controller" });
  ns.vpa({ kind: "Deployment", name: "external-secrets-webhook" });
  ns.vpa(sdkServer);
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

  certController.to(n.kubeApiServer, tcp(6443));
  n.host.to(certController, tcp(8081));
  n.ref("prometheus").to(certController, tcp(8080));

  controller.to(n.kubeApiServer, tcp(6443)).to(sdkServer, tcp(9998));
  n.host.to(controller, tcp(8082));
  n.ref("prometheus").to(controller, tcp(8080));

  sdkServer
    .to(dns("api.bitwarden.com"), tcp(443))
    .to(dns("identity.bitwarden.com"), tcp(443));
  n.host.to(sdkServer, tcp(9998));

  webhook.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.to(webhook, tcp(10250));
  n.host.to(webhook, tcp(8081));
  n.ref("prometheus").to(webhook, tcp(8080));
};
