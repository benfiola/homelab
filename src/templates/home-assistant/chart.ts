import dedent from "ts-dedent";
import { ScalarTag } from "yaml";
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
import { options, stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const include = (file: string) => ({
    __include: true,
    toString: () => file,
  });

  const includeTag: ScalarTag = {
    identify: (v: any) => v.__include,
    resolve: (v) => v,
    tag: "!include",
  };

  const config = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "home-assistant",
    },
    data: {
      "configuration.yaml": stringify(
        options({
          customTags: [includeTag],
          schema: "core",
        }),
        {
          automation: include("automations.yaml"),
          http: {
            use_x_forwarded_for: true,
            trusted_proxies: ["10.244.0.0/16"],
          },
          ingress: {
            frigate: {
              ui_mode: "toolbar",
              title: "Cameras",
              icon: "mdi:cctv",
              url: "http://frigate.frigate.svc:5000",
            },
          },
          logger: {
            default: "info",
          },
          mobile_app: {},
          zeroconf: {},
        },
      ),
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
      "bash",
      "-e",
      "-c",
      dedent(`
        cp /config-map/configuration.yaml /config/configuration.yaml
        echo '{}' > /config/automations.yaml
      `),
    ],
    volumeMounts: {
      "config-map": "/config-map",
      config: "/config",
    },
  });
  statefulSet.addContainer(
    "home-assistant",
    "ghcr.io/benfiola/homelab-images/home-assistant:1.2.0",
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
