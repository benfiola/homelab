import {
  Chart,
  getAssetsServerUrl,
  Namespace,
  StatefulSet,
  TcpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const ss = new StatefulSet(chart, "minecraft", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      data: {
        pvc: { size: "10Gi", storageClass: "replicated" },
      },
    },
  });
  ss.addContainer("minecraft", "itzg/minecraft-server:java25-jdk", {
    containerPorts: { game: 25565 },
    env: {
      EULA: "true",
      VERSION: "1.21.11",
      MODPACK: getAssetsServerUrl("minecraft/mods.zip"),
      TYPE: "FABRIC",
    },
    volumeMounts: {
      data: "/data",
    },
  });

  const svc = ss.createService({ game: 25565 });

  new TcpRoute(chart, "family", "minecraft.bulia.dev", 25565, svc, 25565);

  return chart;
};
