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
  const ns = h.namespace({ privileged: true });

  const secrets = ns.secrets("secrets", [
    "vpn-server-countries",
    "vpn-server-cities",
    "vpn-wireguard-private-key",
  ]);
  ns.nasVolume("media");

  const scripts = ns.configMap(
    "mediarr-mediarr-config-map-scripts",
    h.files(
      "init-data.sh",
      "wait-for-data-init.sh",
      "mss-clamp.sh",
      "run-speed-check.sh",
      "run-scraparr.sh",
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

  ns.deployment("init-fs", {
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
    workload.addVolume("gt-state", {
      ephemeral: { size: "1Gi" },
    });
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
      image: "ghcr.io/qdm12/gluetun:v3.41.3",
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
      image: "ghcr.io/qdm12/gluetun:v3.41.3",
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

  const sonarr = ns
    .statefulSet("sonarr", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi"), data },
    })
    .addContainer("sonarr", {
      image: "ghcr.io/linuxserver/sonarr:4.0.20",
      containerPorts: { web: 8989 },
      env: { ...linuxserver, ...arr("SONARR") },
      volumeMounts: { data: "/data", config: "/config" },
      ...h.probes({ http: { path: "/ping", port: 8989 } }),
    });
  addWaitForDataInitContainer(sonarr);
  sonarr.service({ web: 8989 });

  const radarr = ns
    .statefulSet("radarr", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi"), data },
    })
    .addContainer("radarr", {
      image: "ghcr.io/linuxserver/radarr:6.4.4",
      containerPorts: { web: 7878 },
      env: { ...linuxserver, ...arr("RADARR") },
      volumeMounts: { data: "/data", config: "/config" },
      ...h.probes({ http: { path: "/ping", port: 7878 } }),
    });
  addWaitForDataInitContainer(radarr);
  radarr.service({ web: 7878 });

  const prowlarr = ns
    .statefulSet("prowlarr", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi") },
    })
    .addContainer("prowlarr", {
      image: "ghcr.io/linuxserver/prowlarr:2.7.0",
      containerPorts: { web: 9696 },
      env: { ...linuxserver, ...arr("PROWLARR") },
      volumeMounts: { config: "/config" },
      ...h.probes({ http: { path: "/ping", port: 9696 } }),
    });
  prowlarr.service({ web: 9696 });

  ns.statefulSet("profilarr", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: { config: config("1Gi") },
  }).addContainer("profilarr", {
    image: "ghcr.io/dictionarry-hub/profilarr:2.3.1",
    containerPorts: { web: 6868 },
    env: { ...linuxserver, AUTH: "local" },
    volumeMounts: { config: "/config" },
    ...h.probes({ http: { path: "/api/v1/health", port: 6868 } }),
  });

  const maintainerr = ns
    .statefulSet("maintainerr", {
      securityContext: { uid: 1000, gid: 1000 },
      volumes: { config: config("1Gi") },
    })
    .addContainer("maintainerr", {
      image: "ghcr.io/maintainerr/maintainerr:3.32.0",
      containerPorts: { web: 6246 },
      env: { TZ: h.timezone },
      volumeMounts: { config: "/opt/data" },
      ...h.probes(
        { http: { path: "/api/health/live", port: 6246 } },
        { ready: { http: { path: "/api/health/ready", port: 6246 } } },
      ),
    });

  const seerr = ns
    .statefulSet("seerr", {
      volumes: { config: config("1Gi") },
    })
    .addContainer("seerr", {
      image: "ghcr.io/seerr-team/seerr:v3.5.2",
      containerPorts: { web: 5055 },
      env: { TZ: h.timezone },
      volumeMounts: { config: "/app/config" },
      ...h.probes({ http: { path: "/api/v1/status", port: 5055 } }),
    });
  const seerrService = seerr.service({ web: 5055 });

  const jellyfin = ns
    .statefulSet("jellyfin", {
      securityContext: rootWithCaps,
      volumes: {
        config: config("20Gi"),
        data,
        cache: { ephemeral: { size: "50Gi" } },
      },
    })
    .addContainer("jellyfin", {
      image: "ghcr.io/linuxserver/jellyfin:10.11.11",
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
      ...h.probes({ http: { path: "/health", port: 8096 } }),
    });
  addWaitForDataInitContainer(jellyfin);
  const jellyfinService = jellyfin.service({ web: 8096 });

  const sabnzbd = ns
    .statefulSet("sabnzbd", {
      securityContext: rootWithCaps,
      volumes: { config: config("1Gi"), data },
      dnsConfig: { ndots: 1 },
    })
    .addContainer("sabnzbd", {
      image: "ghcr.io/linuxserver/sabnzbd:5.1.3-ls281",
      containerPorts: { web: 8080 },
      env: linuxserver,
      volumeMounts: { config: "/config", data: "/data" },
      securityContext: {
        ...rootWithCaps,
        caps: [...rootWithCaps.caps, "DAC_READ_SEARCH"],
      },
      ...h.probes({ http: { path: "/api?mode=version", port: 8080 } }),
    });
  addVpnSidecar(sabnzbd, { firewallInputPorts: [8080] });
  addWaitForDataInitContainer(sabnzbd);
  sabnzbd.service({ web: 8080 });

  const scraparr = ns
    .statefulSet("scraparr", {
      securityContext: { uid: 1000, gid: 1000 },
      volumes: {
        config: config("1Gi"),
        scripts: { configMap: scripts.metadata.name },
      },
    })
    .addContainer("scraparr", {
      image: "ghcr.io/thecfu/scraparr:3.2.0",
      containerPorts: { metrics: 7100 },
      cmd: ["sh", "/scripts/run-scraparr.sh"],
      volumeMounts: {
        config: "/config",
        scripts: "/scripts",
      },
      // no liveness or startup probe to allow for adjusting configuration when broken
      readiness: { http: { path: "/metrics", port: 7100 }, timeoutSeconds: 5 },
    });
  scraparr.podMonitor("metrics");

  for (const workload of [
    scraparr,
    sonarr,
    radarr,
    prowlarr,
    maintainerr,
    seerr,
    jellyfin,
    sabnzbd,
  ]) {
    ns.vpa(workload);
  }

  ns.httpRoute("friends", "discover.fiola.dev").match(seerrService, 5055);
  ns.httpRoute("friends", "watch.fiola.dev").match(
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
  const jellyfin = n.subject("mediarr-jellyfin", pod("jellyfin", "mediarr"));
  const maintainerr = n.subject(
    "mediarr-maintainerr",
    pod("maintainerr", "mediarr"),
  );
  const profilarr = n.subject("mediarr-profilarr", pod("profilarr", "mediarr"));
  const prowlarr = n.subject("mediarr-prowlarr", pod("prowlarr", "mediarr"));
  const radarr = n.subject("mediarr-radarr", pod("radarr", "mediarr"));
  const sabnzbd = n.subject("mediarr-sabnzbd", pod("sabnzbd", "mediarr"));
  const scraparr = n.subject("mediarr-scraparr", pod("scraparr", "mediarr"));
  const seerr = n.subject("mediarr-seerr", pod("seerr", "mediarr"));
  const sonarr = n.subject("mediarr-sonarr", pod("sonarr", "mediarr"));

  jellyfin
    .to(dns("*.mirror.jellyfin.org"), tcp(443))
    .to(dns("repo.jellyfin.org"), tcp(443))
    .to(dns("api.themoviedb.org"), tcp(443))
    .to(dns("image.tmdb.org"), tcp(443))
    .to(dns("m.media-amazon.com"), tcp(443))
    .to(dns("www.omdbapi.com"), tcp(443))
    .to(dns("raw.githubusercontent.com"), tcp(443));
  n.host.to(jellyfin, tcp(8096));
  n.ref("gateway-friends").to(jellyfin, tcp(8096));

  maintainerr
    .to(radarr, tcp(7878))
    .to(seerr, tcp(5055))
    .to(sonarr, tcp(8989))
    .to(jellyfin, tcp(8096))
    .to(dns("api.themoviedb.org"), tcp(443));
  n.host.to(maintainerr, tcp(6246));

  profilarr
    .to(radarr, tcp(7878))
    .to(sonarr, tcp(8989))
    .to(dns("github.com"), tcp(443))
    .to(dns("api.github.com"), tcp(443))
    .to(dns("raw.githubusercontent.com"), tcp(443))
    .to(dns("release-assets.githubusercontent.com"), tcp(443));
  n.host.to(profilarr, tcp(6868));

  prowlarr
    .to(radarr, tcp(7878))
    .to(sabnzbd, tcp(8080))
    .to(sonarr, tcp(8989))
    // needs access to all indexers
    .to(cidrs("0.0.0.0/0"), tcp(80, 443));
  n.host.to(prowlarr, tcp(9696));

  radarr
    .to(prowlarr, tcp(9696))
    .to(sabnzbd, tcp(8080))
    // needs access to usenet indexers and metadata endpoints
    .to(cidrs("0.0.0.0/0"), tcp(80, 443));
  n.host.to(radarr, tcp(7878));

  sabnzbd
    // needs access to general VPNs (and VPN healthchecks)
    .to(cidrs("0.0.0.0/0"), udp(51820))
    .to(cidrs("0.0.0.0/0"), icmpv4(3));
  n.host.to(sabnzbd, tcp(8080));

  scraparr
    .to(jellyfin, tcp(8096))
    .to(prowlarr, tcp(9696))
    .to(radarr, tcp(7878))
    .to(sabnzbd, tcp(8080))
    .to(seerr, tcp(5055))
    .to(sonarr, tcp(8989));
  n.ref("prometheus").to(scraparr, tcp(7100));

  seerr
    .to(jellyfin, tcp(8096))
    .to(radarr, tcp(7878))
    .to(sonarr, tcp(8989))
    .to(dns("api.themoviedb.org"), tcp(443))
    .to(dns("api.github.com"), tcp(443))
    .to(dns("raw.githubusercontent.com"), tcp(443))
    .to(dns("api.radarr.video"), tcp(443))
    .to(dns("api4.thetvdb.com"), tcp(443))
    // rotten tomatoes ratings
    .to(dns("79frdp12pn-dsn.algolia.net"), tcp(443));
  n.host.to(seerr, tcp(5055));
  n.ref("gateway-friends").to(seerr, tcp(5055));

  sonarr
    .to(prowlarr, tcp(9696))
    .to(sabnzbd, tcp(8080))
    // needs access to usenet indexers and metadata endpoints
    .to(cidrs("0.0.0.0/0"), tcp(80, 443));
  n.host.to(sonarr, tcp(8989));
};
