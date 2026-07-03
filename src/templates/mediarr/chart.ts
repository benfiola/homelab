import {
  PersistentVolumeClaim,
  Quantity,
} from "../../../assets/kubernetes/k8s";
import {
  Chart,
  Namespace,
  StatefulSet,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(chart);
  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  new PersistentVolumeClaim(chart, "pvc-data", {
    metadata: {
      name: "data",
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: "standard",
      resources: {
        requests: {
          storage: Quantity.fromString("100Gi"),
        },
      },
    },
  });

  const sonarr = new StatefulSet(chart, "sonarr", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
    },
  });
  sonarr.addContainer("sonarr", "lscr.io/linuxserver/sonarr:4.0.19", {
    containerPorts: {
      web: 8989,
    },
    env: {
      PUID: "1000",
      PGID: "1000",
      TZ: "America/Los_Angeles",
    },
    volumeMounts: {
      data: "/data",
      config: "/config",
    },
  });

  const radarr = new StatefulSet(chart, "radarr", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
    },
  });
  radarr.addContainer("radarr", "lscr.io/linuxserver/radarr:6.2.1", {
    containerPorts: {
      web: 7878,
    },
    env: {
      PUID: "1000",
      PGID: "1000",
      TZ: "America/Los_Angeles",
    },
    volumeMounts: {
      data: "/data",
      config: "/config",
    },
  });

  const prowlarr = new StatefulSet(chart, "prowlarr", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
    },
  });
  prowlarr.addContainer("prowlarr", "lscr.io/linuxserver/prowlarr:2.4.0", {
    containerPorts: {
      web: 9696,
    },
    env: {
      PUID: "1000",
      PGID: "1000",
      TZ: "America/Los_Angeles",
    },
    volumeMounts: {
      config: "/config",
    },
  });

  const seerr = new StatefulSet(chart, "seerr", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
    },
  });
  seerr.addContainer("seerr", "ghcr.io/seerr-team/seerr:v3.3.0", {
    containerPorts: {
      web: 5055,
    },
    env: {
      TZ: "America/Los_Angeles",
    },
    volumeMounts: {
      config: "/config",
    },
  });

  const jellyfin = new StatefulSet(chart, "jellyfin", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "3Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
    },
  });
  jellyfin.addContainer("jellyfin", "lscr.io/linuxserver/jellyfin:10.11.1", {
    containerPorts: {
      web: 8096,
    },
    env: {
      PUID: "1000",
      PGID: "1000",
      TZ: "America/Los_Angeles",
    },
    volumeMounts: {
      config: "/config",
      data: { mountPath: "/data", subPath: "media" },
    },
  });

  const qbittorrent = new StatefulSet(chart, "qbittorrent", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
      tun: { hostPath: { path: "/dev/net/tun" } },
      "gluetun-tmp": { emptyDir: {} },
    },
  });
  qbittorrent.addContainer(
    "qbittorrent",
    "lscr.io/linuxserver/qbittorrent:5.2.2",
    {
      containerPorts: {
        web: 8080,
        torrent: 6881,
        "torrent-udp": [6881, "UDP"],
      },
      env: {
        PUID: "1000",
        PGID: "1000",
        TZ: "America/Los_Angeles",
        WEBUI_PORT: "8080",
        QBITTORRENT_INTERFACE: "tunl0",
      },
      volumeMounts: {
        config: "/config",
        data: { mountPath: "/data", subPath: "torrents" },
      },
    },
  );
  qbittorrent.addContainer("gluetun", "ghcr.io/qdm12/gluetun:v3.41.1", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "NET_ADMIN"] },
    env: {
      TZ: "America/Los_Angeles",
      VPN_SERVICE_PROVIDER: "protonvpn",
      VPN_TYPE: "wireguard",
      VPN_PORT_FORWARDING: "on",
      FIREWALL_OUTBOUND_SUBNETS: "10.244.0.0/16",
      WIREGUARD_PRIVATE_KEY: {
        secretKeyRef: {
          name: vaultSecret.name,
          key: "vpn-wireguard-private-key",
        },
      },
      SERVER_COUNTRIES: {
        secretKeyRef: {
          name: vaultSecret.name,
          key: "vpn-server-countries",
        },
      },
      SERVER_CITIES: {
        secretKeyRef: {
          name: vaultSecret.name,
          key: "vpn-server-cities",
        },
      },
    },
    volumeMounts: {
      tun: "/dev/net/tun",
      "gluetun-tmp": "/tmp/gluetun",
    },
    readiness: {
      tcp: { port: 8000 },
      initialDelaySeconds: 10,
    },
    liveness: {
      tcp: { port: 8000 },
      initialDelaySeconds: 30,
    },
  });

  new VerticalPodAutoscaler(chart, sonarr);
  new VerticalPodAutoscaler(chart, radarr);
  new VerticalPodAutoscaler(chart, prowlarr);
  new VerticalPodAutoscaler(chart, seerr);
  new VerticalPodAutoscaler(chart, jellyfin);
  new VerticalPodAutoscaler(chart, qbittorrent);

  return chart;
};
