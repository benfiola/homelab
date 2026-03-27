import { Chart, getSecurityContext, Helm, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const securityContext = getSecurityContext();

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: stringify({
      detectors: {
        ov: {
          type: "openvino",
          device: "AUTO",
        },
      },
      ffmpeg: {
        hwaccel_args: "preset-vaapi",
      },
      mqtt: {
        enabled: false,
      },
    }),
    nodeSelector: {
      "intel.feature.node.kubernetes.io/gpu": "true",
    },
    podSecurityContext: securityContext.pod,
    resources: {
      limits: {
        "gpu.intel.com/i915": "1",
      },
      requests: {
        "gpu.intel.com/i915": "1",
      },
    },
    securityContext: securityContext.container,
  });

  return chart;
};
