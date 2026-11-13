import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "oci://ghcr.io/benfiola/homelab-images/charts/dynamic-dns?version=1.0.12",
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
        metrics: {
          alerts: { enabled: true },
          dashboard: {
            annotations: {
              grafana_folder: h.app,
            },
            enabled: true,
          },
          podMonitor: { enabled: true },
        },
        serviceAccount: { name: "dynamic-dns" },
      },
    },
  );

  ns.secrets("secrets", ["cloudflare-api-token"]);

  ns.vpa({ kind: "Deployment", name: "dynamic-dns" });
};

export const network: NetworkFunction = (n) => {
  const dynamicDns = n.subject(
    "dynamic-dns",
    pod("dynamic-dns", "dynamic-dns"),
  );

  dynamicDns
    .to(dns("api.cloudflare.com"), tcp(443))
    .to(dns("api.ipify.org"), tcp(443));
  n.ref("prometheus").to(dynamicDns, tcp(8080));
};
