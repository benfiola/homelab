import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const statefulSet = new StatefulSet(chart, "music-assistant", {
    volumes: {
      data: { pvc: { size: "10Gi", storageClass: "standard" } },
    },
    podAnnotations: {
      "k8s.v1.cni.cncf.io/networks": "multus-network/mdns@mdns0",
    },
  });
  statefulSet.addContainer(
    "music-assistant",
    "ghcr.io/music-assistant/server:2.9.13",
    {
      containerPorts: {
        ui: [8095, "TCP"],
        stream: [8097, "TCP"],
      },
      volumeMounts: {
        data: "/data",
      },
    },
  );
  const service = statefulSet.createService({ ui: 8095, stream: 8097 });

  new HttpRoute(chart, "family", "listen.fiola.dev").match(service, 8095);
  new HttpRoute(chart, "family", "stream.listen.fiola.dev").match(
    service,
    8097,
    { timeout: "0s" },
  );

  new VerticalPodAutoscaler(chart, statefulSet);

  return chart;
};
