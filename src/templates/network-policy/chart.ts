import { Chart } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import {
  controlPlane as _controlPlane,
  health as _health,
  host as _host,
  kubeApiServer as _kubeApiServer,
  kubeDns as _kubeDns,
  nodes as _nodes,
  pods as _pods,
  cidrs,
  component,
  dns,
  dnsWildcard,
  gateway,
  icmpv4,
  pod,
  services,
  tcp,
  udp,
} from "./policyBuilder";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const svc = services(chart);

  // infrastructure entities
  const controlPlane = svc("control-plane", _controlPlane());
  const kubeApiServer = svc("kube-apiserver", _kubeApiServer());
  const host = svc("host", _host());
  const kubeDns = svc("kube-dns", _kubeDns());
  const nodes = svc("nodes", _nodes());
  const pods = svc("pods", _pods());
  const health = svc("health", _health());

  // application services
  const alertmanager = svc("alertmanager", pod("alertmanager", "alertmanager"));
  const alloy = svc("alloy", pod("alloy", "alloy"));
  const assetsServer = svc(
    "assets-server",
    pod("bucket-server-assets-server", "assets-server"),
  );
  const azerothcoreServer = svc(
    "azerothcore-server",
    pod("server", "azerothcore"),
  );
  const azerothcoreDb = svc("azerothcore-db", pod("db", "azerothcore"));
  const bucketSync = svc("bucket-sync", pod("bucket-sync", "bucket-sync"));
  const bucketSyncJob = svc("bucket-sync-job", pod("bucket-sync-job", "*"));
  const certManagerCainjector = svc(
    "cert-manager-cainjector",
    component("cainjector", "cert-manager"),
  );
  const certManagerController = svc(
    "cert-manager-controller",
    component("controller", "cert-manager"),
  );
  const certManagerStartupapicheck = svc(
    "cert-manager-startupapicheck",
    component("startupapicheck", "cert-manager"),
  );
  const certManagerWebhook = svc(
    "cert-manager-webhook",
    component("webhook", "cert-manager"),
  );
  const ciliumHubbleRelay = svc(
    "cilium-hubble-relay",
    pod("hubble-relay", "cilium"),
  );
  const ciliumHubbleUi = svc("cilium-hubble-ui", pod("hubble-ui", "cilium"));
  const dynamicDns = svc("dynamic-dns", pod("dynamic-dns", "dynamic-dns"));
  const envoyGatewayCertgen = svc(
    "envoy-gateway-certgen",
    component("certgen", "envoy-gateway"),
  );
  const envoyGatewayController = svc(
    "envoy-gateway-controller",
    component("controller", "envoy-gateway"),
  );
  const envoyGatewayProxy = svc(
    "envoy-gateway-proxy",
    component("proxy", "envoy-gateway"),
  );
  const externalDnsCloudflare = svc(
    "external-dns-cloudflare",
    pod("external-dns-cloudflare", "external-dns"),
  );
  const externalDnsMikrotik = svc(
    "external-dns-mikrotik",
    pod("external-dns-mikrotik", "external-dns"),
  );
  const externalSnapshotter = svc(
    "external-snapshotter",
    pod("snapshot-controller", "external-snapshotter"),
  );
  const fluxHelmController = svc(
    "flux-helm-controller",
    component("helm-controller", "flux-system"),
  );
  const fluxKustomizeController = svc(
    "flux-kustomize-controller",
    component("kustomize-controller", "flux-system"),
  );
  const fluxNotificationController = svc(
    "flux-notification-controller",
    component("notification-controller", "flux-system"),
  );
  const fluxSourceController = svc(
    "flux-source-controller",
    component("source-controller", "flux-system"),
  );
  const frigate = svc("frigate", pod("frigate", "frigate"));
  const garage = svc("garage", pod("garage", "garage"));
  const garageOperator = svc(
    "garage-operator",
    pod("garage-operator", "garage-operator"),
  );
  const gatewayRouteSync = svc(
    "gateway-route-sync",
    pod("gateway-route-sync", "gateway-route-sync"),
  );
  const grafana = svc("grafana", pod("grafana", "grafana"));
  const grafanaOperator = svc(
    "grafana-operator",
    component("operator", "grafana-operator"),
  );
  const homeAssistant = svc(
    "home-assistant",
    pod("home-assistant", "home-assistant"),
  );
  const intelDevicePluginsOperator = svc(
    "intel-device-plugins-operator",
    pod("intel-device-plugins-operator", "intel-device-plugins-operator"),
  );
  const kubeStateMetrics = svc(
    "kube-state-metrics",
    component("metrics", "kube-state-metrics"),
  );
  const lokiBackend = svc("loki-backend", component("backend", "loki"));
  const lokiGateway = svc("loki-gateway", component("gateway", "loki"));
  const lokiMemcachedChunksCache = svc(
    "loki-memcached-chunks-cache",
    component("memcached-chunks-cache", "loki"),
  );
  const lokiMemcachedResultsCache = svc(
    "loki-memcached-results-cache",
    component("memcached-results-cache", "loki"),
  );
  const lokiRead = svc("loki-read", component("read", "loki"));
  const lokiWrite = svc("loki-write", component("write", "loki"));
  const metricsServer = svc(
    "metrics-server",
    pod("metrics-server", "metrics-server"),
  );
  const minecraft = svc("minecraft", pod("minecraft", "minecraft"));
  const mosquitto = svc("mosquitto", pod("mosquitto", "mosquitto"));
  const nodeFeatureDiscovery = svc(
    "node-feature-discovery",
    pod("node-feature-discovery", "node-feature-discovery"),
  );
  const linstorAffinityController = svc(
    "linstor-affinity-controller",
    component("linstor-affinity-controller", "piraeus-operator"),
  );
  const linstorController = svc(
    "linstor-controller",
    component("linstor-controller", "piraeus-operator"),
  );
  const linstorCsiController = svc(
    "linstor-csi-controller",
    component("linstor-csi-controller", "piraeus-operator"),
  );
  const linstorCsiNfsServer = svc(
    "linstor-csi-nfs-server",
    component("linstor-csi-nfs-server", "piraeus-operator"),
  );
  const linstorSatellite = svc(
    "linstor-satellite",
    component("linstor-satellite", "piraeus-operator"),
  );
  // const mediarrSonarr = svc("mediarr-sonarr", pod("sonarr", "mediarr"));
  // const mediarrRadarr = svc("mediarr-radarr", pod("radarr", "mediarr"));
  // const mediarrProwlarr = svc("mediarr-prowlarr", pod("prowlarr", "mediarr"));
  const mediarrSeerr = svc("mediarr-seerr", pod("seerr", "mediarr"));
  const mediarrJellyfin = svc("mediarr-jellyfin", pod("jellyfin", "mediarr"));
  const mediarrQbittorrent = svc(
    "mediarr-qbittorrent",
    pod("qbittorrent", "mediarr"),
  );

  const piraeusOperator = svc(
    "piraeus-operator",
    component("piraeus-operator", "piraeus-operator"),
  );
  const piraeusOperatorGencert = svc(
    "piraeus-operator-gencert",
    component("piraeus-operator-gencert", "piraeus-operator"),
  );
  const piraeusOperatorHaController = svc(
    "piraeus-operator-ha-controller",
    component("ha-controller", "piraeus-operator"),
  );
  const postfix = svc("postfix", pod("mail", "postfix"));
  const prometheus = svc("prometheus", pod("prometheus", "prometheus"));
  const prometheusOperator = svc(
    "prometheus-operator",
    component("controller", "prometheus-operator"),
  );
  const pvcRestore = svc("pvc-restore", pod("pvc-restore", "pvc-restore"));
  const routerPolicySync = svc(
    "router-policy-sync",
    pod("router-policy-sync", "router-policy-sync"),
  );
  const singlePlayerTarkov = svc(
    "single-player-tarkov",
    pod("single-player-tarkov", "single-player-tarkov"),
  );
  const tunnel = svc("tunnel", pod("tunnel", "tunnel"));
  const vault = svc("vault", pod("vault", "vault"));
  const vaultPushSecrets = svc(
    "vault-push-secrets",
    pod("vault-push-secrets", "vault-push-secrets"),
  );
  const vaultSecretsOperator = svc(
    "vault-secrets-operator",
    pod("vault-secrets-operator", "vault-secrets-operator"),
  );
  const verticalPodAutoscalerAdmissionController = svc(
    "vertical-pod-autoscaler-admission-controller",
    component("admission-controller", "vertical-pod-autoscaler"),
  );
  const verticalPodAutoscalerRecommender = svc(
    "vertical-pod-autoscaler-recommender",
    component("recommender", "vertical-pod-autoscaler"),
  );
  const verticalPodAutoscalerUpdater = svc(
    "vertical-pod-autoscaler-updater",
    component("updater", "vertical-pod-autoscaler"),
  );
  const volsync = svc("volsync", pod("volsync", "volsync"));
  const volsyncMover = svc("volsync-mover", pod("volsync-mover", "*"));
  const gatewayPublic = svc("gateway-public", gateway("public"));
  const gatewayUsers = svc("gateway-users", gateway("users"));
  const gatewayIot = svc("gateway-iot", gateway("iot"));
  const gatewayPersonal = svc("gateway-personal", gateway("personal"));
  const gatewayInfrastructure = svc(
    "gateway-infrastructure",
    gateway("infrastructure"),
  );

  // alertmanager
  alertmanager.to(postfix, tcp(587));
  host.to(alertmanager, tcp(9093));

  // alloy
  alloy.to(kubeApiServer, tcp(6443)).to(lokiGateway, tcp(8080));
  host.to(alloy, tcp(12345));

  // assets-server
  assetsServer.to(garage, tcp(3900));

  // azerothcore
  azerothcoreServer.to(assetsServer, tcp(8080)).to(azerothcoreDb, tcp(3306));

  // bucket-sync
  bucketSync.to(kubeApiServer, tcp(6443));
  host.to(bucketSync, tcp(8081));
  bucketSyncJob.to(garage, tcp(3900));
  bucketSyncJob.to(dns("*.googleapis.com"), tcp(443));

  // cert-manager
  certManagerCainjector.to(kubeApiServer, tcp(6443));
  certManagerController
    .to(kubeApiServer, tcp(6443))
    .to(dns("api.cloudflare.com"), tcp(443))
    .to(dns("*.ns.cloudflare.com"), udp(53))
    .to(dns("*.api.letsencrypt.org"), tcp(443));
  host.to(certManagerController, tcp(9403));
  certManagerStartupapicheck.to(kubeApiServer, tcp(6443));
  certManagerWebhook.to(kubeApiServer, tcp(6443));
  controlPlane.to(certManagerWebhook, tcp(10250));
  host.to(certManagerWebhook, tcp(6080));

  // cilium
  ciliumHubbleRelay.to(nodes, tcp(4244));
  host.to(ciliumHubbleRelay, tcp(4222));
  ciliumHubbleUi.to(ciliumHubbleRelay, tcp(4245)).to(kubeApiServer, tcp(6443));
  host.to(ciliumHubbleUi, tcp(8081));

  // dynamic-dns
  dynamicDns
    .to(dns("api.cloudflare.com"), tcp(443))
    .to(dns("api.ipify.org"), tcp(443));

  // envoy-gateway
  envoyGatewayCertgen.to(kubeApiServer, tcp(6443));
  controlPlane.to(envoyGatewayController, tcp(9443));
  envoyGatewayController.to(kubeApiServer, tcp(6443));
  host.to(envoyGatewayController, tcp(8081));
  host.to(envoyGatewayProxy, tcp(19002, 19003));

  // external-dns
  externalDnsCloudflare
    .to(kubeApiServer, tcp(6443))
    .to(dns("api.cloudflare.com"), tcp(443));
  host.to(externalDnsCloudflare, tcp(7979, 8080));
  externalDnsMikrotik
    .to(kubeApiServer, tcp(6443))
    .to(dns("router.bulia.dev"), tcp(80));
  host.to(externalDnsMikrotik, tcp(7979, 8080));

  // external-snapshotter
  externalSnapshotter.to(kubeApiServer, tcp(6443));

  // flux
  fluxHelmController.to(kubeApiServer, tcp(6443));
  host.to(fluxHelmController, tcp(9440));
  fluxKustomizeController
    .to(kubeApiServer, tcp(6443))
    .to(fluxNotificationController, tcp(9090))
    .to(fluxSourceController, tcp(9090));
  host.to(fluxKustomizeController, tcp(9440));
  fluxNotificationController.to(kubeApiServer, tcp(6443));
  host.to(fluxNotificationController, tcp(9440));
  fluxSourceController
    .to(kubeApiServer, tcp(6443))
    .to(fluxNotificationController, tcp(9090))
    .to(dns("github.com"), tcp(22));
  host.to(fluxSourceController, tcp(9090, 9440));

  // frigate
  frigate
    .to(mosquitto, tcp(1883))
    .to(assetsServer, tcp(8080))
    .to(dns("*.camera.bulia.dev"), tcp(554));

  host.to(frigate, tcp(5000));

  // garage
  garage.to(garage, tcp(3901));

  // garage-operator
  garageOperator.to(kubeApiServer, tcp(6443)).to(garage, tcp(3903));
  host.to(garageOperator, tcp(8081));

  // gateway-route-sync
  gatewayRouteSync.to(kubeApiServer, tcp(6443));
  host.to(gatewayRouteSync, tcp(8081));

  // grafana
  grafana
    .to(kubeApiServer, tcp(6443))
    .to(lokiGateway, tcp(8080))
    .to(prometheus, tcp(9090));
  host.to(grafana, tcp(3000));

  // grafana-operator
  grafanaOperator.to(kubeApiServer, tcp(6443)).to(grafana, tcp(3000));
  host.to(grafanaOperator, tcp(8081));

  // home-assistant
  homeAssistant
    .to(cidrs("192.168.24.0/24"))
    .to(frigate, tcp(5000, 8554, 8555), udp(8555))
    .to(mosquitto, tcp(1883))
    .to(dns("mobile-apps.home-assistant.io"), tcp(443));

  // intel-device-plugins-operator
  controlPlane.to(intelDevicePluginsOperator, tcp(9443));
  intelDevicePluginsOperator.to(kubeApiServer, tcp(6443));
  host.to(intelDevicePluginsOperator, tcp(8081, 9443));

  // kube-state-metrics
  kubeStateMetrics.to(kubeApiServer, tcp(6443));
  host.to(kubeStateMetrics, tcp(8080, 8081));

  // kube-system
  nodes.to(kubeDns, tcp(53), udp(53));
  host.to(kubeDns, tcp(8080, 8181));
  kubeDns
    .to(kubeApiServer, tcp(6443))
    .to(cidrs("192.168.88.1/32"), tcp(53), udp(53));
  pods.to(kubeDns, tcp(53), udp(53), dnsWildcard());

  // loki
  lokiBackend
    .to(kubeApiServer, tcp(6443))
    .to(garage, tcp(3900))
    .to(lokiRead, tcp(7946))
    .to(lokiWrite, tcp(7946));
  host.to(lokiBackend, tcp(3100));
  lokiGateway.to(lokiRead, tcp(3100)).to(lokiWrite, tcp(3100));
  host.to(lokiGateway, tcp(8080));
  host.to(lokiMemcachedChunksCache, tcp(9150, 11211));
  host.to(lokiMemcachedResultsCache, tcp(9150, 11211));
  lokiRead.to(lokiBackend, tcp(7946, 9095)).to(lokiWrite, tcp(7946, 9095));
  host.to(lokiRead, tcp(3100));
  lokiWrite
    .to(garage, tcp(3900))
    .to(lokiBackend, tcp(7946))
    .to(lokiMemcachedChunksCache, tcp(11211))
    .to(lokiRead, tcp(7946));
  host.to(lokiWrite, tcp(3100));

  // mediarr
  mediarrSeerr.to(mediarrJellyfin, tcp(8096));
  mediarrQbittorrent
    .to(cidrs("0.0.0.0/0"), udp(51820))
    .to(cidrs("0.0.0.0/0"), icmpv4(3));

  // metrics-server
  controlPlane.to(metricsServer, tcp(10250));
  host.to(metricsServer, tcp(10250));
  metricsServer.to(kubeApiServer, tcp(6443)).to(nodes, tcp(10250));

  // minecraft
  minecraft
    .to(assetsServer, tcp(8080))
    .to(dns("launchermeta.mojang.com"), tcp(443))
    .to(dns("api.minecraftservices.com"), tcp(443))
    .to(dns("sessionserver.mojang.com"), tcp(443))
    .to(dns("meta.fabricmc.net"), tcp(443))
    .to(dns("maven.fabricmc.net"), tcp(443));

  // node-feature-discovery
  nodeFeatureDiscovery.to(kubeApiServer, tcp(6443));
  host.to(nodeFeatureDiscovery, tcp(8080));

  // piraeus-operator
  host.to(linstorAffinityController, tcp(8000));
  linstorAffinityController
    .to(kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  host.to(linstorController, tcp(3370));
  linstorController
    .to(kubeApiServer, tcp(6443))
    .to(linstorSatellite, tcp(3366));
  host.to(linstorCsiController, tcp([9808, 9813]));
  linstorCsiController
    .to(kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  nodes.to(linstorCsiNfsServer, tcp(1000));
  linstorCsiNfsServer
    .to(kubeApiServer, tcp(6443))
    .to(linstorController, tcp(3370));
  linstorSatellite.to(linstorSatellite, tcp([7000, 7999]));
  nodes.to(linstorSatellite, tcp(3366));
  host.to(piraeusOperatorHaController, tcp(8000));
  piraeusOperatorHaController.to(kubeApiServer, tcp(6443));
  controlPlane.to(piraeusOperator, tcp(9443));
  host.to(piraeusOperator, tcp(8081));
  piraeusOperator.to(kubeApiServer, tcp(6443)).to(linstorController, tcp(3370));
  piraeusOperatorGencert.to(kubeApiServer, tcp(6443));
  host.to(piraeusOperatorGencert, tcp(8081));

  // postfix
  postfix.to(dns("smtp.mailgun.org"), tcp(587));

  // prometheus
  host.to(prometheus, tcp(9090));
  prometheus
    .to(alertmanager, tcp(9093))
    .to(nodes, tcp(9100, 10250, 10257, 10259))
    .to(kubeApiServer, tcp(6443))
    .to(kubeStateMetrics, tcp(8080));

  // prometheus-operator
  prometheusOperator.to(kubeApiServer, tcp(6443));

  // pvc-restore
  pvcRestore.to(kubeApiServer, tcp(6443));
  host.to(pvcRestore, tcp(8081));

  // router-policy-sync
  routerPolicySync
    .to(kubeApiServer, tcp(6443))
    .to(dns("router.bulia.dev"), tcp(80));
  host.to(routerPolicySync, tcp(8081));

  // single-player-tarkov
  singlePlayerTarkov
    .to(assetsServer, tcp(8080))
    .to(dns("github.com"), tcp(443))
    .to(dns("release-assets.githubusercontent.com"), tcp(443));

  // vault
  vault.to(kubeApiServer, tcp(6443)).to(vault, tcp(8200, 8201));

  // vault-push-secrets
  vaultPushSecrets.to(dns("*.googleapis.com"), tcp(443)).to(vault, tcp(8200));

  // vault-secrets-operator
  vaultSecretsOperator.to(kubeApiServer, tcp(6443)).to(vault, tcp(8200));
  host.to(vaultSecretsOperator, tcp(8081));

  // vertical-pod-autoscaler
  controlPlane.to(verticalPodAutoscalerAdmissionController, tcp(8000));
  host.to(verticalPodAutoscalerAdmissionController, tcp(8000, 8944));
  verticalPodAutoscalerAdmissionController.to(kubeApiServer, tcp(6443));
  host.to(verticalPodAutoscalerRecommender, tcp(8942));
  verticalPodAutoscalerRecommender.to(kubeApiServer, tcp(6443));
  host.to(verticalPodAutoscalerUpdater, tcp(8943));
  verticalPodAutoscalerUpdater.to(kubeApiServer, tcp(6443));

  // volsync
  volsync.to(kubeApiServer, tcp(6443));
  host.to(volsync, tcp(8081));
  volsyncMover.to(dns("*.googleapis.com"), tcp(443));

  // general - bgp
  nodes
    .from(cidrs("192.168.32.1/32"), tcp(179))
    .to(cidrs("192.168.32.1/32"), tcp(179));

  // general - cilium health
  nodes.to(nodes, tcp(4240));

  // general - dhcp
  nodes.to(cidrs("192.168.32.1/32"), udp(67));

  // general - dns
  nodes.to(cidrs("192.168.88.1/32"), tcp(53), udp(53));

  // general - geneve
  nodes.to(nodes, udp(6081));

  // general - health
  nodes.to(health);

  // general - icmp
  nodes.to(nodes, icmpv4(5, 8));
  nodes.to(pods, icmpv4(5, 8));

  // general - image registries
  // NOTE: cilium 1.18.X doesn't support dns-based rules for host policies. for now, allow host-level 0.0.0.0/32:443 egress.
  nodes.to(cidrs("0.0.0.0/0"), tcp(443));

  // general - kube-apiserver
  nodes.to(kubeApiServer, tcp(6443));
  controlPlane.from(cidrs("192.168.32.0/24", "192.168.34.0/24"), tcp(6443));

  // general - kubelet
  nodes.to(nodes, tcp(10250));

  // general - talos
  nodes.to(nodes, tcp(50000));
  controlPlane.from(cidrs("192.168.32.0/24", "192.168.34.0/24"), tcp(50000));
  nodes.to(controlPlane, tcp(50001));

  // general - timeserver
  nodes.to(cidrs("162.159.200.1/32", "162.159.200.123/32"), udp(123));

  // gateways
  gatewayUsers
    .to(azerothcoreServer, tcp(3724, 7878, 8085))
    .to(envoyGatewayController, tcp(18000))
    .to(frigate, tcp(8971))
    .to(homeAssistant, tcp(8123))
    .to(minecraft, tcp(25565))
    .to(singlePlayerTarkov, tcp(6969, 7828, 7829))
    .from(
      cidrs(
        "192.168.8.0/24",
        "192.168.9.0/24",
        "192.168.16.0/24",
        "192.168.17.0/24",
        "192.168.34.0/24",
      ),
      tcp(3724, 6969, 7878, 8085, 10443, 25565),
    );

  gatewayIot
    .to(envoyGatewayController, tcp(18000))
    .from(cidrs("192.168.24.0/24"), tcp(10443));

  gatewayPersonal
    .to(envoyGatewayController, tcp(18000))
    .to(tunnel, tcp(8080, 8081))
    .from(
      cidrs("192.168.16.0/24", "192.168.17.0/24", "192.168.34.0/24"),
      tcp(8080, 10443),
    );

  gatewayInfrastructure
    .to(envoyGatewayController, tcp(18000))
    .to(alertmanager, tcp(9093))
    .to(ciliumHubbleUi, tcp(8081))
    .to(grafana, tcp(3000))
    .to(prometheus, tcp(9090))
    .to(vault, tcp(8200))
    .from(cidrs("192.168.34.0/24"), tcp(10443));

  gatewayPublic
    .to(envoyGatewayController, tcp(18000))
    .from(cidrs("198.51.100.1/32"), tcp(10443));

  return chart;
};
