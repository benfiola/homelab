import dedent from "ts-dedent";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const config = new ConfigMap(chart, `${id}-config-map-config`, {
    metadata: {
      name: "home-assistant-config",
    },
    data: {
      "configuration.yaml": stringify({
        http: {
          use_x_forwarded_for: true,
          trusted_proxies: ["10.244.0.0/16"],
        },
      }),
    },
  });

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    metadata: {
      name: "home-assistant-scripts",
    },
    data: {
      "run.sh": dedent`
        #!/bin/bash
        set -e
        cp /config/configuration.yaml /data
        python -m homeassistant --config /data
      `,
    },
  });

  const statefulSet = new StatefulSet(chart, `${id}-stateful-set`, {
    securityContext: { gid: 0, uid: 0 },
    volumes: {
      config: { configMap: config.name },
      scripts: { configMap: scripts.name },
      data: { pvc: { size: "10Gi", storageClass: "replicated" } },
    },
  });
  statefulSet.addContainer(
    "home-assistant",
    "ghcr.io/home-assistant/home-assistant:2026.5.4",
    {
      env: {
        TZ: "America/Los_Angeles",
      },
      args: ["bash", "/scripts/run.sh"],
      containerPorts: {
        web: [8123, "TCP"],
      },
      volumeMounts: {
        config: "/config",
        data: "/data",
        scripts: "/scripts",
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
