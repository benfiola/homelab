import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace({ privileged: true });

  const secrets = ns.secrets("secrets", [
    "camera-doorbell-password",
    "camera-front-yard-password",
    "camera-garage-password",
    "camera-porch-password",
    "mqtt-password",
  ]);

  const config = ns.configMap("frigate-config", {
    "config.yml": h.files("config.yaml")["config.yaml"],
  });
  ns.nasVolume("nvr");

  const workload = ns
    .statefulSet("frigate", {
      nodeSelector: {
        "intel.feature.node.kubernetes.io/gpu": "true",
      },
      securityContext: {
        uid: 0,
        gid: 0,
        caps: ["CHOWN", "FOWNER", "SETGID", "SETUID", "PERFMON"],
      },
      volumes: {
        config: { pvc: { storageClass: "replicated", size: "1Gi" } },
        configmap: { configMap: config.metadata.name },
        data: { pvc: { name: "nvr" } },
        shm: { memory: { sizeLimit: "768Mi" } },
      },
    })
    .addInitContainer("copy-config", {
      image: h.images.alpine,
      args: ["cp", "/config-map/config.yml", "/config/config.yml"],
      volumeMounts: {
        config: "/config",
        configmap: "/config-map",
      },
    })
    .addContainer("frigate", {
      image: "ghcr.io/benfiola/homelab-images/frigate:1.1.5",
      containerPorts: {
        "http-insecure": 5000,
      },
      env: {
        FRIGATE_CAMERA_DOORBELL_PASSWORD: secrets.key(
          "camera-doorbell-password",
        ),
        FRIGATE_CAMERA_FRONT_YARD_PASSWORD: secrets.key(
          "camera-front-yard-password",
        ),
        FRIGATE_CAMERA_GARAGE_PASSWORD: secrets.key("camera-garage-password"),
        FRIGATE_CAMERA_PORCH_PASSWORD: secrets.key("camera-porch-password"),
        FRIGATE_MQTT_PASSWORD: secrets.key("mqtt-password"),
        TZ: h.timezone,
      },
      resources: {
        limits: { "gpu.intel.com/i915": "1" },
        requests: { "gpu.intel.com/i915": "1" },
      },
      volumeMounts: {
        config: "/config",
        shm: "/dev/shm",
        data: "/media/frigate",
      },
      ...h.probes({ http: { path: "/api/", port: 5000 } }),
    });

  workload.service({ "http-insecure": 5000 });
  workload.podMonitor("http-insecure", { path: "/api/metrics" });
  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const frigate = n.subject("frigate", pod("frigate", "frigate"));

  frigate
    .to(n.ref("llama-cpp"), tcp(8080))
    .to(n.ref("mosquitto"), tcp(1883))
    .to(dns("*.camera.fiola.dev"), tcp(554));
  n.host.to(frigate, tcp(5000));
  n.ref("prometheus").to(frigate, tcp(5000));
};
