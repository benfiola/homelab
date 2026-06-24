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
            enabled: true,
            ffmpeg: {
              hwaccel_args: "preset-intel-qsv-h265",
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/doorbell_substream",
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
            enabled: true,
            ffmpeg: {
              hwaccel_args: "preset-intel-qsv-h265",
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/front-yard_substream",
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
            enabled: true,
            ffmpeg: {
              hwaccel_args: "preset-intel-qsv-h265",
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/garage-substream",
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
            enabled: true,
            ffmpeg: {
              hwaccel_args: "preset-intel-qsv-h265",
              input_args: "preset-rtsp-restream",
              inputs: [
                {
                  path: "rtsp://localhost:8554/porch_substream",
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
          webrtc: {
            doorbell: [
              "rtsp://admin:{CAMERA_DOORBELL_PASSWORD}@doorbell.camera.bulia.dev:554/h265Preview_01_main",
            ],
            doorbell_substream: [
              "rtsp://admin:{CAMERA_DOORBELL_PASSWORD}@doorbell.camera.bulia.dev:554/h265Preview_01_sub",
            ],
            "front-yard": [
              "rtsp://admin:{CAMERA_GARAGE_PASSWORD}@front-yard.camera.bulia.dev:554/Streaming/channels/101",
            ],
            "front-yard_substream": [
              "rtsp://admin:{CAMERA_GARAGE_PASSWORD}@front-yard.camera.bulia.dev:554/Streaming/channels/102",
            ],
            garage: [
              "rtsp://admin:{CAMERA_GARAGE_PASSWORD}@garage.camera.bulia.dev:554/Streaming/channels/101",
            ],
            garage_substream: [
              "rtsp://admin:{CAMERA_GARAGE_PASSWORD}@garage.camera.bulia.dev:554/Streaming/channels/102",
            ],
            porch: [
              "rtsp://admin:{CAMERA_GARAGE_PASSWORD}@porch.camera.bulia.dev:554/Streaming/channels/101",
            ],
            porch_substream: [
              "rtsp://admin:{CAMERA_GARAGE_PASSWORD}@porch.camera.bulia.dev:554/Streaming/channels/102",
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
          password: "{MQTT_PASSWORD}",
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
        CAMERA_DOORBELL_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-doorbell-password",
          },
        },
        CAMERA_FRONT_YARD_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-front-yard-password",
          },
        },
        CAMERA_GARAGE_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-garage-password",
          },
        },
        CAMERA_PORCH_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "camera-porch-password",
          },
        },
        MQTT_PASSWORD: {
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
