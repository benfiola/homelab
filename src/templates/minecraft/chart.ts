import {
  AssetsServer,
  BucketSyncAuth,
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  TcpRoute,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const hostname = "minecraft.fiola.dev";
  const bucketSyncAuth = new BucketSyncAuth(chart);
  const assetsServer = new AssetsServer(chart, bucketSyncAuth);

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
      MODPACK: assetsServer.url("mods.zip"),
      TYPE: "FABRIC",
    },
    volumeMounts: {
      data: "/data",
    },
  });

  const svc = ss.createService({ game: 25565 });

  new TcpRoute(chart, "friends", hostname, 25565, svc, 25565);
  new HttpRoute(chart, "friends", `assets.${hostname}`).match(
    assetsServer.service,
    8080,
  );

  return chart;
};
