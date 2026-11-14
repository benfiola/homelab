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
  const ns = h.namespace({ privileged: true });

  const config = ns.configMap(
    "home-assistant",
    h.files(
      "automations.yaml",
      "configuration.yaml",
      "dashboard-lights.yaml",
      "dashboard-thermostat.yaml",
      "scripts.yaml",
    ),
  );

  const workload = ns
    .statefulSet("home-assistant", {
      securityContext: { gid: 0, uid: 0 },
      volumes: {
        "config-map": { configMap: config.metadata.name },
        config: { pvc: { size: "10Gi", storageClass: "replicated" } },
        media: { pvc: { size: "10Gi", storageClass: "standard" } },
      },
      podAnnotations: {
        "k8s.v1.cni.cncf.io/networks": "multus-network/mdns@mdns0",
      },
    })
    .addInitContainer("copy-config", {
      image: h.images.alpine,
      args: ["sh", "-e", "-c", "cp /config-map/* /config/"],
      volumeMounts: {
        "config-map": "/config-map",
        config: "/config",
      },
    })
    .addContainer("home-assistant", {
      image: "ghcr.io/benfiola/homelab-images/home-assistant:1.9.7",
      env: {
        TZ: h.timezone,
      },
      containerPorts: {
        web: [8123, "TCP"],
      },
      volumeMounts: {
        config: "/config",
        media: "/media",
      },
      ...h.probes({ http: { path: "/", port: 8123 } }),
    });
  const service = workload.service({ web: 8123 });

  workload.podMonitor("web", { path: "/api/prometheus" });
  ns.httpRoute("family", "automation.fiola.dev").match(service, 8123);
  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const homeAssistant = n.subject(
    "home-assistant",
    pod("home-assistant", "home-assistant"),
  );

  homeAssistant
    .from(cidrs("224.0.0.251/32"), udp(5353))
    .to(cidrs("224.0.0.251/32"), udp(5353))
    .to(cidrs("192.168.24.0/24"))
    .to(n.ref("frigate"), tcp(5000, 8554, 8555), udp(8555))
    .to(n.ref("llama-cpp"), tcp(8080))
    .to(n.ref("mosquitto"), tcp(1883))
    .to(n.ref("music-assistant"), tcp(8094, 8095))
    .to(n.ref("wyoming-openai"), tcp(10300))
    .to(n.ref("wyoming-whisper"), tcp(10300))
    .to(dns("mobile-apps.home-assistant.io"), tcp(443));
  n.host.to(homeAssistant, tcp(8123));
  n.ref("prometheus").to(homeAssistant, tcp(8123));
  n.ref("gateway-family").to(homeAssistant, tcp(8123));
};
