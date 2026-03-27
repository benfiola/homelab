import { Chart, getSecurityContext, Helm, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

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
    env: {
      HOME: "/tmp/home",
      S6_YES_I_WANT_A_WORLD_WRITABLE_RUN_BECAUSE_KUBERNETES: "1",
    },
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
