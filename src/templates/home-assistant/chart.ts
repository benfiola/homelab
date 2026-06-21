import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { alpineImage } from "../../image-refs";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const config = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "home-assistant",
    },
    data: {
      "configuration.yaml": stringify({
        http: {
          use_x_forwarded_for: true,
          trusted_proxies: ["10.244.0.0/16"],
        },
        zeroconf: {},
      }),
    },
  });

  const statefulSet = new StatefulSet(chart, "home-assistant", {
    securityContext: { gid: 0, uid: 0 },
    volumes: {
      "config-map": { configMap: config.name },
      config: { pvc: { size: "10Gi", storageClass: "replicated" } },
    },
    podAnnotations: {
      "k8s.v1.cni.cncf.io/networks": "multus-network/mdns@mdns0",
    },
  });
  statefulSet.addInitContainer("copy-config", alpineImage, {
    args: [
      "cp",
      "/config-map/configuration.yaml",
      "/config/configuration.yaml",
    ],
    volumeMounts: {
      "config-map": "/config-map",
      config: "/config",
    },
  });
  statefulSet.addContainer(
    "home-assistant",
    "ghcr.io/benfiola/homelab-home-assistant:0.1.3",
    {
      env: {
        TZ: "America/Los_Angeles",
      },
      containerPorts: {
        web: [8123, "TCP"],
      },
      volumeMounts: {
        config: "/config",
      },
    },
  );

  const service = statefulSet.createService({ web: 8123 });

  new HttpRoute(chart, "users", "home-assistant.bulia.dev").match(
    service,
    8123,
  );

  new VerticalPodAutoscaler(chart, statefulSet);

  return chart;
};
