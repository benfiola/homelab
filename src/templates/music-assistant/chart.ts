import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  TcpRoute,
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
    "ghcr.io/benfiola/homelab-images/music-assistant:1.0.0",
    {
      containerPorts: {
        internal: [8094, "TCP"],
        ui: [8095, "TCP"],
        stream: [8097, "TCP"],
      },
      env: {
        MASS_BASE_URL: "http://stream.listen.fiola.dev:8097",
      },
      volumeMounts: {
        data: "/data",
      },
    },
  );
  const service = statefulSet.createService({
    internal: 8094,
    ui: 8095,
    stream: 8097,
  });

  new HttpRoute(chart, "family", "listen.fiola.dev").match(service, 8095);
  new TcpRoute(chart, "family", "stream.listen.fiola.dev", 8097, service, 8097);

  new VerticalPodAutoscaler(chart, statefulSet);

  return chart;
};
