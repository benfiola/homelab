import dedent from "ts-dedent";
import {
  ConfigMap,
  PersistentVolumeClaim,
  Quantity,
} from "../../../assets/kubernetes/k8s";
import {
  Chart,
  Deployment,
  HttpRoute,
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

  const data = new PersistentVolumeClaim(chart, "pvc-data", {
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

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    data: {
      "init.sh": dedent(`
        #!/bin/bash
        set -e
        echo "initializing data volume"
        mkdir -p /data/torrents/movies
        mkdir -p /data/torrents/tv
        mkdir -p /data/media/movies
        mkdir -p /data/media/tv
        touch /data/.initialized
        echo "data volume initialized"
        sleep infinity
      `),
      "wait-for-init.sh": dedent(`
        #!/bin/bash
        set -e
        file=/data/.initialized
        max_wait=30
        elapsed=0
        while [ ! -f "\${file}" ]; do
          if [ $elapsed -ge \${max_wait} ]; then
            echo "\${file}: timeout after \${elapsed}s"
            exit 1
          fi
          echo "[\${elapsed}s] \${file}: not found"
          sleep 1
          elapsed=$((elapsed + 1))
        done
        echo "\${file}: found"
      `),
    },
  });

  const toolbox = "ghcr.io/benfiola/homelab-images/toolbox:1.1.0";
  const init = new Deployment(chart, "init-fs", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      data: { pvc: { name: "data" } },
      scripts: { configMap: scripts.name },
    },
  });
  init.addContainer("init-fs", toolbox, {
    cmd: ["bash"],
    args: ["/scripts/init.sh"],
    volumeMounts: {
      scripts: { mountPath: "/scripts" },
      data: { mountPath: "/data" },
    },
  });

  const addWaitForInitContainer = (workload: Deployment | StatefulSet) => {
    workload.addVolume("wait-for-init-scripts", { configMap: scripts.name });
    workload.addVolume("wait-for-init-data", { pvc: { name: data.name } });
    workload.addInitContainer("wait-for-init", toolbox, {
      cmd: ["bash"],
      args: ["/scripts/wait-for-init.sh"],
      volumeMounts: {
        "wait-for-init-scripts": { mountPath: "/scripts" },
        "wait-for-init-data": { mountPath: "/data" },
      },
    });
  };

  const addVpnSidecar = (workload: Deployment | StatefulSet) => {
    workload.addVolume("vpn-tun", { hostPath: { path: "/dev/net/tun" } });
    workload.addVolume("vpn-tmp", { emptyDir: {} });
    workload.addContainer("gluetun", "ghcr.io/qdm12/gluetun:v3.41.1", {
      securityContext: {
        uid: 0,
        gid: 0,
        caps: ["CHOWN", "DAC_OVERRIDE", "NET_ADMIN", "NET_RAW"],
      },
      env: {
        DNS_UPSTREAM_RESOLVER_TYPE: "plain",
        FIREWALL_OUTBOUND_SUBNETS: "10.244.0.0/16",
        PORT_FORWARD_ONLY: "yes",
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
        TZ: "America/Los_Angeles",
        VPN_SERVICE_PROVIDER: "protonvpn",
        VPN_TYPE: "wireguard",
        VPN_PORT_FORWARDING: "on",
        WIREGUARD_PRIVATE_KEY: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "vpn-wireguard-private-key",
          },
        },
      },
      volumeMounts: {
        "vpn-tun": "/dev/net/tun",
        "vpn-tmp": "/tmp/gluetun",
      },
    });
  };

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
  addWaitForInitContainer(sonarr);
  sonarr.createService({ web: 8989 });

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
  addWaitForInitContainer(radarr);
  radarr.createService({ web: 7878 });

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
  prowlarr.createService({ web: 9696 });

  const profilarr = new StatefulSet(chart, "profilarr", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
    },
  });
  profilarr.addContainer(
    "profilarr",
    "ghcr.io/dictionarry-hub/profilarr:2.0.9",
    {
      containerPorts: {
        web: 6868,
      },
      env: {
        AUTH: "local",
        PUID: "1000",
        PGID: "1000",
        TZ: "America/Los_Angeles",
      },
      volumeMounts: {
        config: "/config",
      },
    },
  );

  const seerr = new StatefulSet(chart, "seerr", {
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
      config: "/app/config",
    },
  });
  const seerrSvc = seerr.createService({ web: 5055 });

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
      data: { mountPath: "/data" },
    },
  });
  addWaitForInitContainer(jellyfin);
  const jellyfinSvc = jellyfin.createService({ web: 8096 });

  const qbittorrent = new StatefulSet(chart, "qbittorrent", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
      incomplete: { emptyDir: {} },
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
      },
      volumeMounts: {
        config: "/config",
        data: { mountPath: "/data" },
        incomplete: "/incomplete",
      },
    },
  );
  addVpnSidecar(qbittorrent);
  addWaitForInitContainer(qbittorrent);

  new VerticalPodAutoscaler(chart, sonarr);
  new VerticalPodAutoscaler(chart, radarr);
  new VerticalPodAutoscaler(chart, prowlarr);
  new VerticalPodAutoscaler(chart, seerr);
  new VerticalPodAutoscaler(chart, jellyfin);
  new VerticalPodAutoscaler(chart, qbittorrent);

  new HttpRoute(chart, "users", "seerr.bulia.dev").match(seerrSvc, 5055);
  new HttpRoute(chart, "users", "jellyfin.bulia.dev").match(jellyfinSvc, 8096);

  return chart;
};
