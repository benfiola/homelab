import {
  Chart,
  findApiObject,
  Helm,
  HttpRoute,
  Namespace,
  VaultAuth,
  VaultDynamicSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultDynamicSecret(chart, vaultAuth, (secret) => ({
    FRIGATE_MQTT_PASSWORD: secret("mqtt-password"),
    FRIGATE_RTSP_PASSWORD: "super-insecure",
  }));

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: stringify({
      mqtt: {
        host: "mosquitto.mosquitto.svc",
        port: 1883,
        user: "frigate",
        password: "{FRIGATE_MQTT_PASSWORD}",
      },
      cameras: {
        fake: {
          enabled: false,
          ffmpeg: {
            hwaccel_args: "preset-vaapi",
            inputs: [
              {
                path: "rtsp://viewer:{FRIGATE_RTSP_PASSWORD}@198.51.100.1:554/cam/realmonitor?channel=1&subtype=2",
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
      telemetry: {
        stats: {
          intel_gpu_stats: false,
        },
      },
    }),
    envFromSecrets: [vaultSecret.name],
    image: {
      tag: "0.17.1",
    },
    nodeSelector: {
      "intel.feature.node.kubernetes.io/gpu": "true",
    },
    resources: {
      limits: {
        "gpu.intel.com/i915": "1",
      },
      requests: {
        "gpu.intel.com/i915": "1",
      },
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "frigate",
    }),
    { advisory: true },
  );

  new HttpRoute(chart, "users", "frigate.bulia.dev").match(
    findApiObject(chart, {
      apiVersion: "v1",
      kind: "Service",
      name: "frigate",
    }),
    8971,
  );

  return chart;
};
