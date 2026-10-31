import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "https://kubernetes-sigs.github.io/external-dns/external-dns?version=1.23.0",
    { release: "external-dns-mikrotik", values: "values-mikrotik.yaml" },
  );

  h.helm(
    "https://kubernetes-sigs.github.io/external-dns/external-dns?version=1.23.0",
    {
      release: "external-dns-cloudflare",
      values: "values-cloudflare.yaml",
      crds: false,
    },
  );

  h.namespace();

  h.configMap("config", {
    "routeros-username": "external-dns",
  });

  h.secrets();

  h.vpa({ kind: "Deployment", name: "external-dns-mikrotik" });

  h.vpa({ kind: "Deployment", name: "external-dns-cloudflare" });
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
  externalDnsMikrotik
    .to(n.kubeApiServer, tcp(6443))
    .to(dns("router.fiola.dev"), tcp(80));
  n.host.to(externalDnsMikrotik, tcp(7979, 8080));
};
