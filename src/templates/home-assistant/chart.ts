import { readFile } from "fs/promises";
import path from "path";
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
import { alpineImage } from "../../image-refs";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const files = ["configuration.yaml", "dashboard-thermostat.yaml"].map((v) =>
    path.join(__dirname, v),
  );
  const config = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "home-assistant",
    },
    data: Object.fromEntries(
      await Promise.all(
        files.map(async (f) => [
          path.basename(f),
          (await readFile(f)).toString(),
        ]),
      ),
    ),
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
      "sh",
      "-e",
      "-c",
      dedent(`
        cp /config-map/* /config/
      `),
    ],
    volumeMounts: {
      "config-map": "/config-map",
      config: "/config",
    },
  });
  statefulSet.addContainer(
    "home-assistant",
    "ghcr.io/benfiola/homelab-images/home-assistant:1.3.0",
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

  new HttpRoute(chart, "users", "automation.bulia.dev").match(service, 8123);

  new VerticalPodAutoscaler(chart, statefulSet);

  return chart;
};
