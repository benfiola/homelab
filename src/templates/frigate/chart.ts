import { Secret } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  findApiObject,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const secrets = new Secret(chart, `${id}-secrets`, {
    metadata: {
      name: "secrets",
    },
    stringData: {
      FRIGATE_RTSP_PASSWORD: "super-insecure",
    },
  });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: stringify({
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
      mqtt: {
        enabled: false,
      },
    }),
    envFromSecrets: [secrets.name],
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
  );

  return chart;
};
