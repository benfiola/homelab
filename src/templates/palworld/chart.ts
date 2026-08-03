import {
  Chart,
  HttpRoute,
  Namespace,
  StatefulSet,
  UdpRoute,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const image = "ghcr.io/benfiola/homelab-images/palworld:1.0.1";
  const hostname = "palworld.bulia.dev";

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const statefulSet = new StatefulSet(chart, "palworld", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      data: {
        pvc: { size: "5Gi", storageClass: "standard" },
      },
      cache: {
        pvc: { size: "15Gi", storageClass: "standard" },
      },
    },
  });

  statefulSet.addContainer("palworld", image, {
    containerPorts: {
      game: [8211, "UDP"],
      mgmt: 8080,
    },
    env: {
      ADMIN_PASSWORD: {
        secretKeyRef: {
          name: vaultSecret.name,
          key: "admin-password",
        },
      },
      SERVER_NAME: "palworld.bulia.dev",
      TZ: "America/Los_Angeles",
      UPDATE_CHECK_INTERVAL: "15m",
    },
    volumeMounts: {
      cache: "/cache",
      data: "/data",
    },
  });

  const svc = statefulSet.createService({
    game: [8211, "UDP"],
    mgmt: 8080,
  });

  new VerticalPodAutoscaler(chart, statefulSet);

  new UdpRoute(chart, "friends", hostname, 8211, svc, 8211);
  new HttpRoute(chart, "friends", `admin.${hostname}`).match(svc, 8080);

  return chart;
};
