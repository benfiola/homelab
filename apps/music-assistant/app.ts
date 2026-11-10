import type { AppFunction } from "../../tools/lib/app.ts";
import {
  cidrs,
  dns,
  pod,
  tcp,
  udp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  const workload = ns
    .statefulSet("music-assistant", {
      volumes: {
        data: { pvc: { size: "10Gi", storageClass: "standard" } },
      },
      podAnnotations: {
        "k8s.v1.cni.cncf.io/networks": "multus-network/mdns@mdns0",
      },
    })
    .addContainer("music-assistant", {
      image: "ghcr.io/benfiola/homelab-images/music-assistant:1.1.3",
      containerPorts: {
        internal: [8094, "TCP"],
        ui: [8095, "TCP"],
        stream: [8097, "TCP"],
      },
      env: {
        MASS_BASE_URL: "http://stream.listen.fiola.dev:8097",
      },
      volumeMounts: {
        data: "/data",
      },
      ...h.probes({ http: { path: "/info", port: 8095 } }),
    });
  const service = workload.service({ internal: 8094, ui: 8095, stream: 8097 });

  ns.httpRoute("family", "listen.fiola.dev").match(service, 8095);
  ns.tcpRoute("family", "stream.listen.fiola.dev", 8097, service, 8097);
  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const musicAssistant = n.subject(
    "music-assistant",
    pod("music-assistant", "music-assistant"),
  );

  n.host.to(musicAssistant, tcp(8095));
  musicAssistant
    .from(cidrs("224.0.0.251/32"), udp(5353))
    .to(cidrs("224.0.0.251/32"), udp(5353))
    .to(cidrs("192.168.24.0/24"))
    .to(n.ref("gateway-family"), tcp(8097))
    .to(dns("itunes.apple.com"), tcp(443))
    .to(dns("tidal.com"), tcp(443))
    .to(dns("*.tidal.com"), tcp(443))
    .to(dns("*.*.tidal.com"), tcp(443));
  n.ref("gateway-family").to(musicAssistant, tcp(8095, 8097));
};
