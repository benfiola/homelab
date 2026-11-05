import type { AppFunction, Env, Workload } from "../../tools/lib/app.ts";
import {
  cidrs,
  dns,
  icmpv4,
  pod,
  tcp,
  udp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace({ privileged: true });

  const secrets = h.secrets("secrets", [
    "vpn-server-countries",
    "vpn-server-cities",
    "vpn-wireguard-private-key",
  ]);
  h.nasVolume("media");

  const scripts = h.configMap(
    "mediarr-mediarr-config-map-scripts",
    h.files(
      "init-data.sh",
      "wait-for-data-init.sh",
      "mss-clamp.sh",
      "run-speed-check.sh",
    ),
  );

  const toolbox = h.images.toolbox;
  const data = { pvc: { name: "media" } };
  const config = (size: string) => ({
    pvc: { size, storageClass: "standard" },
  });
  const linuxserver = { PUID: "1000", PGID: "1000", TZ: h.timezone };
  // the *arr apps' shared settings
  const arr = (name: string) => ({
    [`${name}__APP__INSTANCENAME`]: name[0] + name.slice(1).toLowerCase(),
    [`${name}__APP__LAUNCHBROWSER`]: "false",
    [`${name}__AUTH__METHOD`]: "Forms",
    [`${name}__AUTH__REQUIRED`]: "DisabledForLocalAddresses",
    [`${name}__LOG__ANALYTICSENABLED`]: "False",
  });
  const rootWithCaps = { uid: 0, gid: 0, caps: ["CHOWN", "SETUID", "SETGID"] };

  h.deployment("init-fs", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      data,
      scripts: { configMap: scripts.metadata.name },
    },
  }).addContainer("init-fs", {
    image: toolbox,
    cmd: ["bash"],
    args: ["/scripts/init-data.sh"],
    volumeMounts: {
      scripts: "/scripts",
      data: "/data",
    },
  });

  const addWaitForDataInitContainer = (workload: Workload) => {
    workload.addVolume("wfdi-scripts", { configMap: scripts.metadata.name });
    workload.addVolume("wfdi-data", data);
    workload.addInitContainer("wait-for-data-init", {
      image: toolbox,
      cmd: ["bash"],
      args: ["/scripts/wait-for-data-init.sh"],
      volumeMounts: {
        "wfdi-scripts": "/scripts",
        "wfdi-data": "/data",
      },
    });
  };

  const addVpnSidecar = (
    workload: Workload,
    opts: {
      firewallInputPorts: number[];
      portForwarding?: { upCommand: string; downCommand: string };
    },
  ) => {
    workload.addVolume("gt-tun", { hostPath: { path: "/dev/net/tun" } });
    workload.addVolume("gt-state", { emptyDir: {} });
    workload.addVolume("gt-scripts", { configMap: scripts.metadata.name });

    const env: Env = {
      DNS_UPSTREAM_RESOLVER_TYPE: "plain",
      FIREWALL_OUTBOUND_SUBNETS: "10.244.0.0/16",
      FIREWALL_INPUT_PORTS: opts.firewallInputPorts.join(","),
      SERVER_COUNTRIES: secrets.key("vpn-server-countries"),
      SERVER_CITIES: secrets.key("vpn-server-cities"),
      TZ: h.timezone,
      VPN_SERVICE_PROVIDER: "protonvpn",
      VPN_TYPE: "wireguard",
      WIREGUARD_MTU: "1360",
      WIREGUARD_PERSISTENT_KEEPALIVE_INTERVAL: "5s",
      WIREGUARD_PRIVATE_KEY: secrets.key("vpn-wireguard-private-key"),
    };

    if (opts.portForwarding) {
      env.PORT_FORWARD_ONLY = "yes";
      env.VPN_PORT_FORWARDING = "on";
      env.VPN_PORT_FORWARDING_UP_COMMAND = opts.portForwarding.upCommand;
      env.VPN_PORT_FORWARDING_DOWN_COMMAND = opts.portForwarding.downCommand;
    }

    workload.addContainer("gluetun", {
      image: "ghcr.io/qdm12/gluetun:v3.41.1",
      securityContext: {
        uid: 0,
        gid: 0,
        caps: ["CHOWN", "DAC_OVERRIDE", "NET_ADMIN", "NET_RAW"],
      },
      env,
      volumeMounts: {
        "gt-tun": "/dev/net/tun",
        "gt-state": "/tmp/gluetun",
        "gt-scripts": "/scripts",
      },
      liveness: {
        exec: { command: ["/bin/sh", "/scripts/run-speed-check.sh"] },
        initialDelaySeconds: 120,
        periodSeconds: 600,
        timeoutSeconds: 30,
        failureThreshold: 3,
      },
    });

    workload.addVolume("mss-clamp-scripts", {
      configMap: scripts.metadata.name,
    });
    workload.addContainer("mss-clamp", {
      image: "ghcr.io/qdm12/gluetun:v3.41.1",
      securityContext: {
        uid: 0,
        gid: 0,
        caps: ["NET_ADMIN"],
      },
      cmd: ["/bin/sh"],
      args: ["/scripts/mss-clamp.sh"],
      volumeMounts: {
        "mss-clamp-scripts": "/scripts",
      },
    });
  };

  const sonarr = h
    .statefulSet("sonarr", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi"), data },
    })
    .addContainer("sonarr", {
      image: "lscr.io/linuxserver/sonarr:4.0.19",
      containerPorts: { web: 8989 },
      env: { ...linuxserver, ...arr("SONARR") },
      volumeMounts: { data: "/data", config: "/config" },
    });
  addWaitForDataInitContainer(sonarr);
  sonarr.service({ web: 8989 });

  const radarr = h
    .statefulSet("radarr", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi"), data },
    })
    .addContainer("radarr", {
      image: "lscr.io/linuxserver/radarr:6.4.4",
      containerPorts: { web: 7878 },
      env: { ...linuxserver, ...arr("RADARR") },
      volumeMounts: { data: "/data", config: "/config" },
    });
  addWaitForDataInitContainer(radarr);
  radarr.service({ web: 7878 });

  const prowlarr = h
    .statefulSet("prowlarr", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi") },
    })
    .addContainer("prowlarr", {
      image: "lscr.io/linuxserver/prowlarr:2.4.0",
      containerPorts: { web: 9696 },
      env: { ...linuxserver, ...arr("PROWLARR") },
      volumeMounts: { config: "/config" },
    });
  prowlarr.service({ web: 9696 });

  h.statefulSet("profilarr", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: { config: config("1Gi") },
  }).addContainer("profilarr", {
    image: "ghcr.io/dictionarry-hub/profilarr:2.0.9",
    containerPorts: { web: 6868 },
    env: { ...linuxserver, AUTH: "local" },
    volumeMounts: { config: "/config" },
  });

  const maintainerr = h
    .statefulSet("maintainerr", {
      securityContext: { uid: 1000, gid: 1000 },
      volumes: { config: config("1Gi") },
    })
    .addContainer("maintainerr", {
      image: "ghcr.io/maintainerr/maintainerr:3.18.0",
      containerPorts: { web: 6246 },
      env: { TZ: h.timezone },
      volumeMounts: { config: "/opt/data" },
    });

  const seerr = h
    .statefulSet("seerr", {
      volumes: { config: config("1Gi") },
    })
    .addContainer("seerr", {
      image: "ghcr.io/seerr-team/seerr:v3.3.0",
      containerPorts: { web: 5055 },
      env: { TZ: h.timezone },
      volumeMounts: { config: "/app/config" },
    });
  const seerrService = seerr.service({ web: 5055 });

  const jellyfin = h
    .statefulSet("jellyfin", {
      securityContext: rootWithCaps,
      volumes: {
        config: config("20Gi"),
        data,
        cache: { emptyDir: { sizeLimit: "50Gi" } },
      },
    })
    .addContainer("jellyfin", {
      image: "lscr.io/linuxserver/jellyfin:10.11.11",
      containerPorts: { web: 8096 },
      env: linuxserver,
      resources: {
        limits: { "gpu.intel.com/i915": "1" },
        requests: { "gpu.intel.com/i915": "1" },
      },
      volumeMounts: {
        config: "/config",
        data: "/data",
        cache: "/config/cache",
      },
    });
  addWaitForDataInitContainer(jellyfin);
  const jellyfinService = jellyfin.service({ web: 8096 });

  const sabnzbd = h
    .statefulSet("sabnzbd", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi"), data },
      dnsConfig: { ndots: 1 },
    })
    .addContainer("sabnzbd", {
      image: "lscr.io/linuxserver/sabnzbd:5.0.4-ls261",
      containerPorts: { web: 8080 },
      env: linuxserver,
      volumeMounts: { config: "/config", data: "/data" },
    });
  addVpnSidecar(sabnzbd, { firewallInputPorts: [8080] });
  addWaitForDataInitContainer(sabnzbd);
  sabnzbd.service({ web: 8080 });

  for (const workload of [
    sonarr,
    radarr,
    prowlarr,
    maintainerr,
    seerr,
    jellyfin,
    sabnzbd,
  ]) {
    h.vpa(workload);
  }

  h.httpRoute("friends", "discover.fiola.dev").match(seerrService, 5055);
  h.httpRoute("friends", "watch.fiola.dev").match(
    jellyfinService,
    8096,
    {},
    {
      path: "^/Items/[^/]+/Download$",
      pathType: "RegularExpression",
      timeout: "0s",
    },
  );
};

export const network: NetworkFunction = (n) => {
  const mediarrJellyfin = n.subject(
    "mediarr-jellyfin",
    pod("jellyfin", "mediarr"),
  );
  const mediarrMaintainerr = n.subject(
    "mediarr-maintainerr",
    pod("maintainerr", "mediarr"),
  );
  const mediarrProfilarr = n.subject(
    "mediarr-profilarr",
    pod("profilarr", "mediarr"),
  );
  const mediarrProwlarr = n.subject(
    "mediarr-prowlarr",
    pod("prowlarr", "mediarr"),
  );
  const mediarrRadarr = n.subject("mediarr-radarr", pod("radarr", "mediarr"));
  const mediarrSabnzbd = n.subject(
    "mediarr-sabnzbd",
    pod("sabnzbd", "mediarr"),
  );
  const mediarrSeerr = n.subject("mediarr-seerr", pod("seerr", "mediarr"));
  const mediarrSonarr = n.subject("mediarr-sonarr", pod("sonarr", "mediarr"));

  mediarrJellyfin
    .to(dns("*.mirror.jellyfin.org"), tcp(443))
    .to(dns("repo.jellyfin.org"), tcp(443))
    .to(dns("api.themoviedb.org"), tcp(443))
    .to(dns("image.tmdb.org"), tcp(443))
    .to(dns("m.media-amazon.com"), tcp(443))
    .to(dns("www.omdbapi.com"), tcp(443))
    .to(dns("raw.githubusercontent.com"), tcp(443));
  mediarrProfilarr
    .to(mediarrRadarr, tcp(7878))
    .to(mediarrSonarr, tcp(8989))
    .to(dns("github.com"), tcp(443))
    .to(dns("api.github.com"), tcp(443))
    .to(dns("raw.githubusercontent.com"), tcp(443))
    .to(dns("release-assets.githubusercontent.com"), tcp(443));
  mediarrMaintainerr
    .to(mediarrRadarr, tcp(7878))
    .to(mediarrSeerr, tcp(5055))
    .to(mediarrSonarr, tcp(8989))
    .to(mediarrJellyfin, tcp(8096))
    .to(dns("api.themoviedb.org"), tcp(443));
  mediarrProwlarr
    .to(mediarrRadarr, tcp(7878))
    .to(mediarrSabnzbd, tcp(8080))
    .to(mediarrSonarr, tcp(8989))
    // needs access to all indexers
    .to(cidrs("0.0.0.0/0"), tcp(80, 443));
  mediarrRadarr
    .to(mediarrProwlarr, tcp(9696))
    .to(mediarrSabnzbd, tcp(8080))
    // needs access to usenet indexers and metadata endpoints
    .to(cidrs("0.0.0.0/0"), tcp(80, 443));
  mediarrSeerr
    .to(mediarrJellyfin, tcp(8096))
    .to(mediarrRadarr, tcp(7878))
    .to(mediarrSonarr, tcp(8989))
    .to(dns("api.themoviedb.org"), tcp(443))
    .to(dns("api.github.com"), tcp(443))
    .to(dns("raw.githubusercontent.com"), tcp(443))
    .to(dns("api.radarr.video"), tcp(443))
    .to(dns("api4.thetvdb.com"), tcp(443))
    // rotten tomatoes ratings
    .to(dns("79frdp12pn-dsn.algolia.net"), tcp(443));
  mediarrSonarr
    .to(mediarrProwlarr, tcp(9696))
    .to(mediarrSabnzbd, tcp(8080))
    // needs access to usenet indexers and metadata endpoints
    .to(cidrs("0.0.0.0/0"), tcp(80, 443));
  mediarrSabnzbd
    // needs access to general VPNs (and VPN healthchecks)
    .to(cidrs("0.0.0.0/0"), udp(51820))
    .to(cidrs("0.0.0.0/0"), icmpv4(3));
  n.ref("gateway-friends")
    .to(mediarrJellyfin, tcp(8096))
    .to(mediarrSeerr, tcp(5055));
};
