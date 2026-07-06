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
  WorkloadEnv,
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
          storage: Quantity.fromString("1000Gi"),
        },
      },
    },
  });

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    data: {
      "init-data.sh": dedent(`
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
      "wait-for-data-init.sh": dedent(`
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
      "notify-vpn-forwarding-port.sh": dedent(`
        #!/bin/sh
        set -e
        direction="\${1}"
        if [ "\${direction}" = "up" ]; then
          port="\${2}"
          interface="\${3}"
          payload=$(printf '{"listen_port":%s,"current_network_interface":"%s","random_port":false,"upnp":false}' "\${port}" "\${interface}")
        else
          payload='{"listen_port":0,"current_network_interface":"lo"}'
        fi
        wget -O- -nv --retry-connrefused --post-data "json=\${payload}" http://127.0.0.1:8080/api/v2/app/setPreferences
      `),
      "prepare-install-jellyfin-theme.sh": dedent(`
        #!/bin/sh
        set -e
        url="https://raw.githubusercontent.com/AumGupta/abyss-jellyfin/refs/tags/v1.2.1/scripts/docker/abyss-spotlight.sh"
        curl -fsSL -o /custom-cont-init.d/install-theme.sh "\${url}"
        chmod +x /custom-cont-init.d/install-theme.sh
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
    args: ["/scripts/init-data.sh"],
    volumeMounts: {
      scripts: "/scripts",
      data: "/data",
    },
  });

  const addWaitForDataInitContainer = (workload: Deployment | StatefulSet) => {
    workload.addVolume("wfdi-scripts", { configMap: scripts.name });
    workload.addVolume("wfdi-data", { pvc: { name: data.name } });
    workload.addInitContainer("wait-for-data-init", toolbox, {
      cmd: ["bash"],
      args: ["/scripts/wait-for-data-init.sh"],
      volumeMounts: {
        "wfdi-scripts": "/scripts",
        "wfdi-data": "/data",
      },
    });
  };

  const addVpnSidecar = (
    workload: Deployment | StatefulSet,
    opts: {
      firewallInputPorts: number[];
      portForwarding?: { upCommand: string; downCommand: string };
    },
  ) => {
    workload.addVolume("gt-tun", { hostPath: { path: "/dev/net/tun" } });
    workload.addVolume("gt-state", { emptyDir: {} });

    const env: WorkloadEnv = {
      DNS_UPSTREAM_RESOLVER_TYPE: "plain",
      FIREWALL_OUTBOUND_SUBNETS: "10.244.0.0/16",
      FIREWALL_INPUT_PORTS: opts.firewallInputPorts.join(","),
      SERVER_COUNTRIES: {
        secretKeyRef: { name: vaultSecret.name, key: "vpn-server-countries" },
      },
      SERVER_CITIES: {
        secretKeyRef: { name: vaultSecret.name, key: "vpn-server-cities" },
      },
      TZ: "America/Los_Angeles",
      VPN_SERVICE_PROVIDER: "protonvpn",
      VPN_TYPE: "wireguard",
      WIREGUARD_PRIVATE_KEY: {
        secretKeyRef: {
          name: vaultSecret.name,
          key: "vpn-wireguard-private-key",
        },
      },
    };

    const volumeMounts: Record<string, string> = {
      "gt-tun": "/dev/net/tun",
      "gt-state": "/tmp/gluetun",
    };

    if (opts.portForwarding) {
      workload.addVolume("gt-scripts", { configMap: scripts.name });
      volumeMounts["gt-scripts"] = "/scripts";
      env.PORT_FORWARD_ONLY = "yes";
      env.VPN_PORT_FORWARDING = "on";
      env.VPN_PORT_FORWARDING_UP_COMMAND = opts.portForwarding.upCommand;
      env.VPN_PORT_FORWARDING_DOWN_COMMAND = opts.portForwarding.downCommand;
    }

    workload.addContainer("gluetun", "ghcr.io/qdm12/gluetun:v3.41.1", {
      securityContext: {
        uid: 0,
        gid: 0,
        caps: ["CHOWN", "DAC_OVERRIDE", "NET_ADMIN", "NET_RAW"],
      },
      env,
      volumeMounts,
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
      SONARR__APP__INSTANCENAME: "Sonarr",
      SONARR__APP__LAUNCHBROWSER: "false",
      SONARR__AUTH__METHOD: "Forms",
      SONARR__AUTH__REQUIRED: "DisabledForLocalAddresses",
      SONARR__LOG__ANALYTICSENABLED: "False",
    },
    volumeMounts: {
      data: "/data",
      config: "/config",
    },
  });
  addWaitForDataInitContainer(sonarr);
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
      RADARR__APP__INSTANCENAME: "Radarr",
      RADARR__APP__LAUNCHBROWSER: "false",
      RADARR__AUTH__METHOD: "Forms",
      RADARR__AUTH__REQUIRED: "DisabledForLocalAddresses",
      RADARR__LOG__ANALYTICSENABLED: "False",
    },
    volumeMounts: {
      data: "/data",
      config: "/config",
    },
  });
  addWaitForDataInitContainer(radarr);
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
      PROWLARR__APP__INSTANCENAME: "Prowlarr",
      PROWLARR__APP__LAUNCHBROWSER: "false",
      PROWLARR__AUTH__METHOD: "Forms",
      PROWLARR__AUTH__REQUIRED: "DisabledForLocalAddresses",
      PROWLARR__LOG__ANALYTICSENABLED: "False",
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
        PUID: "1000",
        PGID: "1000",
        TZ: "America/Los_Angeles",
        AUTH: "local",
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
      init: { emptyDir: {} },
      scripts: { configMap: scripts.name },
    },
  });
  jellyfin.addInitContainer("prepare-install-jellyfin-theme", toolbox, {
    cmd: ["bash"],
    args: ["/scripts/prepare-install-jellyfin-theme.sh"],
    volumeMounts: {
      scripts: "/scripts",
      init: "/custom-cont-init.d",
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
    resources: {
      limits: { "gpu.intel.com/i915": "1" },
      requests: { "gpu.intel.com/i915": "1" },
    },
    volumeMounts: {
      config: "/config",
      data: "/data",
      init: "/custom-cont-init.d",
    },
  });
  addWaitForDataInitContainer(jellyfin);
  const jellyfinSvc = jellyfin.createService({ web: 8096 });

  const qbittorrent = new StatefulSet(chart, "qbittorrent", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
      scripts: { configMap: scripts.name },
      "qb-incomplete": { emptyDir: {} },
    },
    dnsConfig: {
      ndots: 1,
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
        data: "/data",
        "qb-incomplete": "/incomplete",
      },
    },
  );
  addVpnSidecar(qbittorrent, {
    firewallInputPorts: [8080],
    portForwarding: {
      upCommand:
        "/bin/sh /scripts/notify-vpn-forwarding-port.sh up {{PORT}} {{VPN_INTERFACE}}",
      downCommand: "/bin/sh /scripts/notify-vpn-forwarding-port.sh down",
    },
  });
  addWaitForDataInitContainer(qbittorrent);
  qbittorrent.createService({ web: 8080 });

  const sabnzbd = new StatefulSet(chart, "sabnzbd", {
    securityContext: { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] },
    volumes: {
      config: { pvc: { size: "1Gi", storageClass: "standard" } },
      data: { pvc: { name: "data" } },
    },
    dnsConfig: {
      ndots: 1,
    },
  });
  sabnzbd.addContainer("sabnzbd", "lscr.io/linuxserver/sabnzbd:5.0.4-ls261", {
    containerPorts: {
      web: 8080,
    },
    env: {
      PUID: "1000",
      PGID: "1000",
      TZ: "America/Los_Angeles",
    },
    volumeMounts: {
      config: "/config",
      data: "/data",
    },
  });
  addVpnSidecar(sabnzbd, {
    firewallInputPorts: [8080],
  });
  addWaitForDataInitContainer(sabnzbd);
  sabnzbd.createService({ web: 8080 });

  const byparr = new StatefulSet(chart, "byparr", {
    securityContext: { uid: 1000, gid: 1000 },
  });
  byparr.addContainer("byparr", "ghcr.io/thephaseless/byparr:2.1.0", {
    containerPorts: {
      web: 8191,
    },
    env: {
      LOG_LEVEL: "DEBUG",
    },
  });
  byparr.createService({ web: 8191 });

  new VerticalPodAutoscaler(chart, sonarr);
  new VerticalPodAutoscaler(chart, radarr);
  new VerticalPodAutoscaler(chart, prowlarr);
  new VerticalPodAutoscaler(chart, seerr);
  new VerticalPodAutoscaler(chart, jellyfin);
  new VerticalPodAutoscaler(chart, qbittorrent);
  new VerticalPodAutoscaler(chart, sabnzbd);
  new VerticalPodAutoscaler(chart, byparr);

  new HttpRoute(chart, "users", "discover.bulia.dev").match(seerrSvc, 5055);
  new HttpRoute(chart, "users", "watch.bulia.dev").match(jellyfinSvc, 8096);

  return chart;
};
