import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace({ privileged: true });

  h.secrets();

  const config = h.configMap("frigate-config", {
    "config.yml": h.files("config.yaml")["config.yaml"],
  });
  h.nasVolume("nvr");

  const workload = h
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
        shm: { emptyDir: { medium: "Memory", sizeLimit: "768Mi" } },
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
      image: "ghcr.io/benfiola/homelab-images/frigate:1.0.1",
      containerPorts: {
        "http-insecure": 5000,
      },
      env: {
        FRIGATE_CAMERA_DOORBELL_PASSWORD: h.secretKey(
          "camera-doorbell-password",
        ),
        FRIGATE_CAMERA_FRONT_YARD_PASSWORD: h.secretKey(
          "camera-front-yard-password",
        ),
        FRIGATE_CAMERA_GARAGE_PASSWORD: h.secretKey("camera-garage-password"),
        FRIGATE_CAMERA_PORCH_PASSWORD: h.secretKey("camera-porch-password"),
        FRIGATE_MQTT_PASSWORD: h.secretKey("mqtt-password"),
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
      liveness: {
        http: { path: "/api/", port: 5000 },
        initialDelaySeconds: 60,
      },
      readiness: {
        http: { path: "/api/", port: 5000 },
        initialDelaySeconds: 60,
      },
    });

  workload.service({ "http-insecure": 5000 });
  h.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const frigate = n.subject("frigate", pod("frigate", "frigate"));

  frigate
    .to(n.ref("llama-cpp"), tcp(8080))
    .to(n.ref("mosquitto"), tcp(1883))
    .to(dns("*.camera.fiola.dev"), tcp(554));
  n.host.to(frigate, tcp(5000));
};
