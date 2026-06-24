import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { alpineImage } from "../../image-refs";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const config = new ConfigMap(chart, `${id}-config-map-config`, {
    metadata: {
      name: "frigate-config",
    },
    data: {
      "config.yml": stringify({
        cameras: {
          doorbell: {
            detect: {
              enabled: true,
            },
            enabled: true,
            ffmpeg: {
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/doorbell_sub",
                  roles: ["detect"],
                },
                {
                  path: "rtsp://localhost:8554/doorbell",
                  roles: ["record"],
                },
              ],
            },
          },
          "front-yard": {
            detect: {
              enabled: true,
            },
            enabled: true,
            ffmpeg: {
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/front-yard_sub",
                  roles: ["detect"],
                },
                {
                  path: "rtsp://localhost:8554/front-yard",
                  roles: ["record"],
                },
              ],
            },
          },
          garage: {
            detect: {
              enabled: true,
            },
            enabled: true,
            ffmpeg: {
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/garage_sub",
                  roles: ["detect"],
                },
                {
                  path: "rtsp://localhost:8554/garage",
                  roles: ["record"],
                },
              ],
            },
          },
          porch: {
            detect: {
              enabled: true,
            },
            enabled: true,
            ffmpeg: {
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/porch_sub",
                  roles: ["detect"],
                },
                {
                  path: "rtsp://localhost:8554/porch",
                  roles: ["record"],
                },
              ],
            },
          },
        },
        detectors: {
          ov: {
            type: "openvino",
            device: "GPU",
          },
        },
        go2rtc: {
          streams: {
            // NOTE: go2rtc stream passwords *must* be url-encoded (see: https://github.com/AlexxIT/go2rtc/issues/1217#issuecomment-2242296489)
            doorbell: [
              "rtsp://admin:{FRIGATE_CAMERA_DOORBELL_PASSWORD}@doorbell.camera.bulia.dev:554/h265Preview_01_main",
            ],
            doorbell_sub: [
              "rtsp://admin:{FRIGATE_CAMERA_DOORBELL_PASSWORD}@doorbell.camera.bulia.dev:554/h265Preview_01_sub",
            ],
            "front-yard": [
              "rtsp://admin:{FRIGATE_CAMERA_FRONT_YARD_PASSWORD}@front-yard.camera.bulia.dev:554/Streaming/channels/101",
            ],
            "front-yard_sub": [
              "rtsp://admin:{FRIGATE_CAMERA_FRONT_YARD_PASSWORD}@front-yard.camera.bulia.dev:554/Streaming/channels/102",
            ],
            garage: [
              "rtsp://admin:{FRIGATE_CAMERA_GARAGE_PASSWORD}@garage.camera.bulia.dev:554/Streaming/channels/101",
            ],
            garage_sub: [
              "rtsp://admin:{FRIGATE_CAMERA_GARAGE_PASSWORD}@garage.camera.bulia.dev:554/Streaming/channels/102",
            ],
            porch: [
              "rtsp://admin:{FRIGATE_CAMERA_PORCH_PASSWORD}@porch.camera.bulia.dev:554/Streaming/channels/101",
            ],
            porch_sub: [
              "rtsp://admin:{FRIGATE_CAMERA_PORCH_PASSWORD}@porch.camera.bulia.dev:554/Streaming/channels/102",
            ],
            candidates: ["10.244.0.0/16"],
          },
        },
        model: {
          width: 300,
          height: 300,
          input_tensor: "nhwc",
          input_pixel_format: "bgr",
          path: "/openvino-model/ssdlite_mobilenet_v2.xml",
          labelmap_path: "/openvino-model/coco_91cl_bkgr.txt",
        },
        mqtt: {
          enabled: true,
          host: "mosquitto.mosquitto.svc",
          port: 1883,
          user: "frigate",
          password: "{FRIGATE_MQTT_PASSWORD}",
        },
        objects: {
          track: [
            "backpack",
            "bicycle",
            "bird",
            "bus",
            "car",
            "cat",
            "dog",
            "handbag",
            "hat",
            "motorcycle",
            "person",
            "skateboard",
            "suitcase",
            "umbrella",
          ],
        },
        record: {
          enabled: true,
          continuous: {
            days: 0,
          },
          motion: {
            days: 1,
          },
          alerts: {
            retain: {
              days: 1,
              mode: "all",
            },
          },
          detections: {
            retain: {
              days: 1,
              mode: "all",
            },
          },
        },
        semantic_search: {
          enabled: false,
        },
        telemetry: {
          stats: {
            intel_gpu_stats: true,
          },
        },
        tls: {
          enabled: false,
        },
      }),
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
        "http-secure": 8971,
        rtsp: 8554,
        webrtc: 8555,
        "webrtc-udp": [8555, "UDP"],
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

  const service = statefulSet.createService({
    "http-insecure": 5000,
    "http-secure": 8971,
    rtsp: 8554,
    webrtc: 8555,
    "webrtc-udp": [8555, "UDP"],
  });

  new VerticalPodAutoscaler(chart, statefulSet, { advisory: true });

  new HttpRoute(chart, "users", "frigate.bulia.dev").match(service, 8971);

  return chart;
};
