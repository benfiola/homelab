import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "oci://ghcr.io/benfiola/homelab-images/charts/dynamic-dns?version=1.0.9",
    {
      values: {
        config: {
          cloudflareApiTokenSecret: "secrets",
          cloudflareApiTokenKey: "cloudflare-api-token",
          cloudflareZones: [
            {
              name: "fiola.dev",
              domains: ["current.fiola.dev", "wireguard.fiola.dev"],
            },
          ],
        },
        serviceAccount: { name: "dynamic-dns" },
      },
    },
  );

  h.namespace();

  h.secrets("secrets", ["cloudflare-api-token"]);

  h.vpa({ kind: "Deployment", name: "dynamic-dns" });
};

export const network: NetworkFunction = (n) => {
  const dynamicDns = n.subject(
    "dynamic-dns",
    pod("dynamic-dns", "dynamic-dns"),
  );

  dynamicDns
    .to(dns("api.cloudflare.com"), tcp(443))
    .to(dns("api.ipify.org"), tcp(443));
};
