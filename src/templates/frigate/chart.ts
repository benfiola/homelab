import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
  getAssetsServerUrl,
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
        mqtt: {
          host: "mosquitto.mosquitto.svc",
          port: 1883,
          user: "frigate",
          password: "{FRIGATE_MQTT_PASSWORD}",
        },
        cameras: {
          demo: {
            enabled: true,
            detect: {
              enabled: true,
            },
            ffmpeg: {
              hwaccel_args: "preset-vaapi",
              inputs: [
                {
                  path: "rtsp://localhost:8553/demo",
                  roles: ["detect"],
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
        model: {
          width: 300,
          height: 300,
          input_tensor: "nhwc",
          input_pixel_format: "bgr",
          path: "/openvino-model/ssdlite_mobilenet_v2.xml",
          labelmap_path: "/openvino-model/coco_91cl_bkgr.txt",
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
      config: { emptyDir: {} },
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
        http: 8971,
        rtsp: 8554,
      },
      env: {
        FRIGATE_MQTT_PASSWORD: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "mqtt-password",
          },
        },
        FRIGATE_RTSP_PASSWORD: "super-secure",
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

  const demoVideoUrl = getAssetsServerUrl(
    "frigate-demo-videos/VIRAT_S_000201_05_001081_001215.mp4",
  );
  statefulSet.addContainer("mediamtx", "bluenviron/mediamtx:1.19.1-ffmpeg", {
    containerPorts: { rtsp: 8553 },
    env: {
      MTX_RTSPADDRESS: ":8553",
      MTX_RTMP: "no",
      MTX_HLS: "no",
      MTX_WEBRTC: "no",
      MTX_SRT: "no",
      MTX_PATHS_DEMO_RUNONINIT: `ffmpeg -re -stream_loop -1 -i ${demoVideoUrl} -c:v libx264 -preset ultrafast -c:a copy -f rtsp rtsp://localhost:8553/demo`,
      MTX_PATHS_DEMO_RUNONINITRESTART: "yes",
    },
  });

  const service = statefulSet.createService({ http: 8971 });

  new VerticalPodAutoscaler(chart, statefulSet, { advisory: true });

  new HttpRoute(chart, "users", "frigate.bulia.dev").match(service, 8971);

  return chart;
};
