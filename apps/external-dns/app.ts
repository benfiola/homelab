import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  const externalDns = h.helmImage(
    "registry.k8s.io/external-dns/external-dns:v0.24.0",
  );

  await ns.helm(
    "https://kubernetes-sigs.github.io/external-dns/external-dns?version=1.23.0",
    {
      release: "external-dns-mikrotik",
      values: {
        annotationFilter: "homelab.benfiola.com/use-external-dns-mikrotik",
        enableGatewayListenerSets: true,
        image: externalDns,
        nameOverride: "external-dns-mikrotik",
        policy: "sync",
        serviceMonitor: { enabled: true },
        provider: {
          name: "webhook",
          webhook: {
            env: [
              { name: "MIKROTIK_BASEURL", value: "http://router.fiola.dev" },
              {
                name: "MIKROTIK_PASSWORD",
                valueFrom: {
                  secretKeyRef: { name: "secrets", key: "routeros-password" },
                },
              },
              {
                name: "MIKROTIK_USERNAME",
                valueFrom: {
                  configMapKeyRef: { name: "config", key: "routeros-username" },
                },
              },
            ],
            image: h.helmImage(
              "ghcr.io/mirceanton/external-dns-provider-mikrotik:v1.6.3",
            ),
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
              privileged: false,
              runAsGroup: 1000,
              runAsNonRoot: true,
              runAsUser: 1000,
            },
          },
        },
        sources: [
          "gateway-grpcroute",
          "gateway-httproute",
          "gateway-tcproute",
          "gateway-tlsroute",
          "gateway-udproute",
        ],
      },
    },
  );

  await ns.helm(
    "https://kubernetes-sigs.github.io/external-dns/external-dns?version=1.23.0",
    {
      release: "external-dns-cloudflare",
      values: {
        annotationFilter: "homelab.benfiola.com/use-external-dns-cloudflare",
        enableGatewayListenerSets: true,
        image: externalDns,
        env: [
          {
            name: "CF_API_TOKEN",
            valueFrom: {
              secretKeyRef: { name: "secrets", key: "cloudflare-api-token" },
            },
          },
        ],
        nameOverride: "external-dns-cloudflare",
        policy: "sync",
        serviceMonitor: { enabled: true },
        provider: { name: "cloudflare" },
        sources: [
          "gateway-grpcroute",
          "gateway-httproute",
          "gateway-tcproute",
          "gateway-tlsroute",
          "gateway-udproute",
        ],
      },
      crds: false,
    },
  );

  ns.configMap("config", {
    "routeros-username": "external-dns",
  });

  ns.secrets("secrets", ["cloudflare-api-token", "routeros-password"]);

  ns.vpa({ kind: "Deployment", name: "external-dns-mikrotik" });

  ns.vpa({ kind: "Deployment", name: "external-dns-cloudflare" });
};

export const network: NetworkFunction = (n) => {
  const externalDnsCloudflare = n.subject(
    "external-dns-cloudflare",
    pod("external-dns-cloudflare", "external-dns"),
  );
  const externalDnsMikrotik = n.subject(
    "external-dns-mikrotik",
    pod("external-dns-mikrotik", "external-dns"),
  );

  externalDnsCloudflare
    .to(n.kubeApiServer, tcp(6443))
    .to(dns("api.cloudflare.com"), tcp(443));
  n.host.to(externalDnsCloudflare, tcp(7979, 8080));
  n.ref("prometheus").to(externalDnsCloudflare, tcp(7979));

  externalDnsMikrotik
    .to(n.kubeApiServer, tcp(6443))
    .to(dns("router.fiola.dev"), tcp(80));
  n.host.to(externalDnsMikrotik, tcp(7979, 8080));
  n.ref("prometheus").to(externalDnsMikrotik, tcp(7979, 8080));
};
