import { readFile } from "fs/promises";
import path from "path";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  Namespace,
  StatefulSet,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { alpineImage } from "../../image-refs";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const configFile = path.join(__dirname, "config.yaml");
  const config = new ConfigMap(chart, `${id}-config-map-config`, {
    metadata: {
      name: "frigate-config",
    },
    data: {
      "config.yml": (await readFile(configFile)).toString(),
    },
  });

  const statefulSet = new StatefulSet(chart, "frigate", {
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
      configmap: { configMap: config.name },
      shm: { emptyDir: { medium: "Memory", sizeLimit: "768Mi" } },
    },
  });
  statefulSet.addInitContainer("copy-config", alpineImage, {
    args: ["cp", "/config-map/config.yml", "/config/config.yml"],
    volumeMounts: {
      config: "/config",
      configmap: "/config-map",
    },
  });
  statefulSet.addContainer(
    "frigate",
    "ghcr.io/blakeblackshear/frigate:0.17.1",
    {
      containerPorts: {
        "http-insecure": 5000,
      },
      env: {
        FRIGATE_CAMERA_DOORBELL_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-doorbell-password",
          },
        },
        FRIGATE_CAMERA_FRONT_YARD_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-front-yard-password",
          },
        },
        FRIGATE_CAMERA_GARAGE_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-garage-password",
          },
        },
        FRIGATE_CAMERA_PORCH_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-porch-password",
          },
        },
        FRIGATE_MQTT_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "mqtt-password",
          },
        },
      },
      resources: {
        limits: { "gpu.intel.com/i915": "1" },
        requests: { "gpu.intel.com/i915": "1" },
      },
      volumeMounts: {
        config: "/config",
        shm: "/dev/shm",
      },
      liveness: {
        http: { path: "/api/", port: 5000 },
        initialDelaySeconds: 60,
      },
      readiness: {
        http: { path: "/api/", port: 5000 },
        initialDelaySeconds: 60,
      },
    },
  );

  statefulSet.createService({
    "http-insecure": 5000,
  });

  new VerticalPodAutoscaler(chart, statefulSet);

  return chart;
};
