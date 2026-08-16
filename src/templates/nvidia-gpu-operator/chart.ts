import { ConfigMap } from "../../../assets/kubernetes/k8s";
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

  const config = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "user-config",
    },
    data: {
      "any": stringify({
        version: "v1",
        flags: {
          migStrategy: "none",
        },
        sharing: {
          timeSlicing: {
            resources: [
              {
                name: "nvidia.com/gpu",
                replicas: 127,
              },
            ],
          },
        },
      }),
    },
  });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    dcgmExporter: {
      enabled: false,
    },
    devicePlugin: {
      config: {
        name: config.name,
        default: "any",
      },
    },
    driver: {
      enabled: false,
    },
    hostPaths: {
      driverInstallDir: "/usr/local",
    },
    migManager: {
      enabled: false,
    },
    nfd: {
      enabled: false,
    },
    nodeStatusExporter: {
      enabled: false,
    },
    operator: {
      resources: null,
    },
    toolkit: {
      enabled: false,
    },
  });

  const deployment = findApiObject(chart, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    name: "gpu-operator",
  });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
