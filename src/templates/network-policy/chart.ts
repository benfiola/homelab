import { Chart } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import {
  allNodes,
  allPods,
  cidrs,
  component,
  controlPlane,
  createPolicyBuilder,
  dns,
  gateway,
  health,
  host,
  icmpv4,
  kubeDns,
  pod,
  tcp,
  udp,
} from "./policyBuilder";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);

  const policy = createPolicyBuilder(chart);

  // alertmanager
  policy("host-to-alertmanager").allowBetween(
    host(),
    pod("alertmanager", "alertmanager"),
    tcp(9093),
  );

  policy("alertmanager-to-postfix").allowBetween(
    pod("alertmanager", "alertmanager"),
    pod("mail", "postfix"),
    tcp(587),
  );

  // alloy
  policy("alloy-to-control-plane").allowBetween(
    pod("alloy", "alloy"),
    controlPlane(),
    tcp(6443),
  );

  policy("alloy-to-loki-gateway").allowBetween(
    pod("alloy", "alloy"),
    component("gateway", "loki"),
    tcp(8080),
  );

  policy("host-to-alloy").allowBetween(
    host(),
    pod("alloy", "alloy"),
    tcp(12345),
  );

  // cert-manager
  policy("cert-manager-cainjector-to-control-plane").allowBetween(
    component("cainjector", "cert-manager"),
    controlPlane(),
    tcp(6443),
  );

  policy("cert-manager-controller-to-cloudflare--egress")
    .targets(component("controller", "cert-manager"))
    .allowEgressTo(dns("api.cloudflare.com"), tcp(443))
    .allowEgressTo(dns("*.ns.cloudflare.com"), udp(53));

  policy("cert-manager-controller-to-letsencrypt--egress")
    .targets(component("controller", "cert-manager"))
    .allowEgressTo(dns("*.api.letsencrypt.org"), tcp(443));

  policy("cert-manager-controller-to-control-plane").allowBetween(
    component("controller", "cert-manager"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-cert-manager-controller").allowBetween(
    host(),
    component("controller", "cert-manager"),
    tcp(9403),
  );

  policy("cert-manager-webhook-to-control-plane").allowBetween(
    component("webhook", "cert-manager"),
    controlPlane(),
    tcp(6443),
  );

  policy("control-plane-to-cert-manager-webhook").allowBetween(
    controlPlane(),
    component("webhook", "cert-manager"),
    tcp(10250),
  );

  policy("host-to-cert-manager-webhook").allowBetween(
    host(),
    component("webhook", "cert-manager"),
    tcp(6080),
  );

  // cilium
  policy("cilium-hubble-relay-to-host").allowBetween(
    pod("hubble-relay", "cilium"),
    host(),
    tcp(4244),
  );

  policy("cilium-hubble-relay-to-nodes").allowBetween(
    pod("hubble-relay", "cilium"),
    allNodes(),
    tcp(4244),
  );

  policy("host-to-cilium-hubble-relay").allowBetween(
    host(),
    pod("hubble-relay", "cilium"),
    tcp(4222),
  );

  policy("cilium-hubble-ui-to-cilium-hubble-relay").allowBetween(
    pod("hubble-ui", "cilium"),
    pod("hubble-relay", "cilium"),
    tcp(4245),
  );

  policy("cilium-hubble-ui-to-control-plane").allowBetween(
    pod("hubble-ui", "cilium"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-cilium-hubble-ui").allowBetween(
    host(),
    pod("hubble-ui", "cilium"),
    tcp(8081),
  );

  // dynamic-dns
  policy("dynamic-dns-to-cloudflare--egress")
    .targets(pod("dynamic-dns", "dynamic-dns"))
    .allowEgressTo(dns("api.cloudflare.com"), tcp(443));

  policy("dynamic-dns-to-ipify--egress")
    .targets(pod("dynamic-dns", "dynamic-dns"))
    .allowEgressTo(dns("api.ipify.org"), tcp(443));

  // envoy-gateway
  policy("envoy-gateway-certgen-to-control-plane").allowBetween(
    component("certgen", "envoy-gateway"),
    controlPlane(),
    tcp(6443),
  );

  policy("control-plane-to-envoy-gateway-controller").allowBetween(
    controlPlane(),
    component("controller", "envoy-gateway"),
    tcp(9443),
  );

  policy("envoy-gateway-controller-to-control-plane").allowBetween(
    component("controller", "envoy-gateway"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-envoy-gateway-controller").allowBetween(
    host(),
    component("controller", "envoy-gateway"),
    tcp(8081),
  );

  policy("host-to-envoy-gateway-proxy").allowBetween(
    host(),
    component("proxy", "envoy-gateway"),
    tcp(19002, 19003),
  );

  // external-dns
  policy("external-dns-cloudflare-to-control-plane").allowBetween(
    pod("external-dns-cloudflare", "external-dns"),
    controlPlane(),
    tcp(6443),
  );

  policy("external-dns-cloudflare-to-cloudflare--egress")
    .targets(pod("external-dns-cloudflare", "external-dns"))
    .allowEgressTo(dns("api.cloudflare.com"), tcp(443));

  policy("host-to-external-dns-cloudflare").allowBetween(
    host(),
    pod("external-dns-cloudflare", "external-dns"),
    tcp(7979, 8080),
  );

  policy("external-dns-mikrotik-to-control-plane").allowBetween(
    pod("external-dns-mikrotik", "external-dns"),
    controlPlane(),
    tcp(6443),
  );

  policy("external-dns-mikrotik-to-router--egress")
    .targets(pod("external-dns-mikrotik", "external-dns"))
    .allowEgressTo(dns("router.bulia"), tcp(80));

  policy("host-to-external-dns-mikrotik").allowBetween(
    host(),
    pod("external-dns-mikrotik", "external-dns"),
    tcp(7979, 8080),
  );

  // external-snapshotter
  policy("external-snapshotter-to-control-plane").allowBetween(
    pod("snapshot-controller", "external-snapshotter"),
    controlPlane(),
    tcp(6443),
  );

  // flux
  policy("flux-helm-controller-to-control-plane").allowBetween(
    component("helm-controller", "flux-system"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-flux-helm-controller").allowBetween(
    host(),
    component("helm-controller", "flux-system"),
    tcp(9440),
  );

  policy("flux-kustomize-controller-to-control-plane").allowBetween(
    component("kustomize-controller", "flux-system"),
    controlPlane(),
    tcp(6443),
  );

  policy(
    "flux-kustomize-controller-to-flux-notification-controller",
  ).allowBetween(
    component("kustomize-controller", "flux-system"),
    component("notification-controller", "flux-system"),
    tcp(9090),
  );

  policy("flux-kustomize-controller-to-flux-source-controller").allowBetween(
    component("kustomize-controller", "flux-system"),
    component("source-controller", "flux-system"),
    tcp(9090),
  );

  policy("host-to-flux-kustomize-controller").allowBetween(
    host(),
    component("kustomize-controller", "flux-system"),
    tcp(9440),
  );

  policy("flux-notification-controller-to-control-plane").allowBetween(
    component("notification-controller", "flux-system"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-flux-notification-controller").allowBetween(
    host(),
    component("notification-controller", "flux-system"),
    tcp(9440),
  );

  policy("flux-source-controller-to-control-plane").allowBetween(
    component("source-controller", "flux-system"),
    controlPlane(),
    tcp(6443),
  );

  policy("flux-source-controller-to-flux-notification-controller").allowBetween(
    component("source-controller", "flux-system"),
    component("notification-controller", "flux-system"),
    tcp(9090),
  );

  policy("flux-source-controller-to-github--egress")
    .targets(component("source-controller", "flux-system"))
    .allowEgressTo(dns("github.com"), tcp(22));

  policy("host-to-flux-source-controller").allowBetween(
    host(),
    component("source-controller", "flux-system"),
    tcp(9090, 9440),
  );

  // gateway-route-sync
  policy("host-to-gateway-route-sync").allowBetween(
    host(),
    pod("gateway-route-sync", "gateway-route-sync"),
    tcp(8081),
  );

  policy("gateway-route-sync-to-control-plane").allowBetween(
    pod("gateway-route-sync", "gateway-route-sync"),
    controlPlane(),
    tcp(6443),
  );

  // grafana
  policy("grafana-to-control-plane").allowBetween(
    pod("grafana", "grafana"),
    controlPlane(),
    tcp(6443),
  );

  policy("grafana-to-loki-gateway").allowBetween(
    pod("grafana", "grafana"),
    component("gateway", "loki"),
    tcp(8080),
  );

  policy("grafana-to-prometheus").allowBetween(
    pod("grafana", "grafana"),
    pod("prometheus", "prometheus"),
    tcp(9090),
  );

  policy("host-to-grafana").allowBetween(
    host(),
    pod("grafana", "grafana"),
    tcp(3000),
  );

  // grafana-operator
  policy("grafana-operator-to-control-plane").allowBetween(
    component("operator", "grafana-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("grafana-operator-to-grafana").allowBetween(
    component("operator", "grafana-operator"),
    pod("grafana", "grafana"),
    tcp(3000),
  );

  policy("host-to-grafana-operator").allowBetween(
    host(),
    component("operator", "grafana-operator"),
    tcp(8081),
  );

  // kube-state-metrics
  policy("kube-state-metrics-to-control-plane").allowBetween(
    component("metrics", "kube-state-metrics"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-kube-state-metrics").allowBetween(
    host(),
    component("metrics", "kube-state-metrics"),
    tcp(8080, 8081),
  );

  // kube-system
  policy("all-nodes-to-kube-dns").allowBetween(
    allNodes(),
    kubeDns(),
    tcp(53),
    udp(53),
  );

  policy("host-to-kube-dns").allowBetween(
    host(),
    kubeDns(),
    tcp(53, 8080, 8181),
    udp(53),
  );

  policy("kube-dns-to-host").allowBetween(kubeDns(), host(), tcp(6443));

  policy("kube-dns-to-control-plane").allowBetween(
    kubeDns(),
    controlPlane(),
    tcp(6443),
  );

  policy("kube-dns-to-router-dns--egress")
    .targets(kubeDns())
    .allowEgressTo(cidrs("192.168.88.1/32"), tcp(53), udp(53));

  policy("pods-to-kube-dns").allowBetween(
    allPods(),
    kubeDns(true),
    tcp(53),
    udp(53),
  );

  // loki
  policy("loki-backend-to-control-plane").allowBetween(
    component("backend", "loki"),
    controlPlane(),
    tcp(6443),
  );

  policy("loki-backend-to-loki-read").allowBetween(
    component("backend", "loki"),
    component("read", "loki"),
    tcp(7946),
  );

  policy("loki-backend-to-loki-write").allowBetween(
    component("backend", "loki"),
    component("write", "loki"),
    tcp(7946),
  );

  policy("host-to-loki-backend").allowBetween(
    host(),
    component("backend", "loki"),
    tcp(3100),
  );

  policy("loki-gateway-to-loki-write").allowBetween(
    component("gateway", "loki"),
    component("write", "loki"),
    tcp(3100),
  );

  policy("host-to-loki-gateway").allowBetween(
    host(),
    component("gateway", "loki"),
    tcp(8080),
  );

  policy("host-to-loki-memcached-chunks-cache").allowBetween(
    host(),
    component("memcached-chunks-cache", "loki"),
    tcp(9150, 11211),
  );

  policy("host-to-loki-memcached-results-cache").allowBetween(
    host(),
    component("memcached-results-cache", "loki"),
    tcp(9150, 11211),
  );

  policy("loki-read-to-loki-backend").allowBetween(
    component("read", "loki"),
    component("backend", "loki"),
    tcp(7946, 9095),
  );

  policy("loki-read-to-loki-write").allowBetween(
    component("read", "loki"),
    component("write", "loki"),
    tcp(7946),
  );

  policy("host-to-loki-read").allowBetween(
    host(),
    component("read", "loki"),
    tcp(3100),
  );

  policy("host-to-loki-write").allowBetween(
    host(),
    component("write", "loki"),
    tcp(3100),
  );

  policy("loki-write-to-loki-backend").allowBetween(
    component("write", "loki"),
    component("backend", "loki"),
    tcp(7946),
  );

  policy("loki-write-to-loki-memcached-chunks-cache").allowBetween(
    component("write", "loki"),
    component("memcached-chunks-cache", "loki"),
    tcp(11211),
  );

  policy("loki-write-to-loki-read").allowBetween(
    component("write", "loki"),
    component("read", "loki"),
    tcp(7946),
  );

  // metrics-server
  policy("control-plane-to-metrics-server").allowBetween(
    controlPlane(),
    pod("metrics-server", "metrics-server"),
    tcp(10250),
  );

  policy("host-to-metrics-server").allowBetween(
    host(),
    pod("metrics-server", "metrics-server"),
    tcp(10250),
  );

  policy("metrics-server-to-control-plane").allowBetween(
    pod("metrics-server", "metrics-server"),
    controlPlane(),
    tcp(6443),
  );

  policy("metrics-server-to-host").allowBetween(
    pod("metrics-server", "metrics-server"),
    host(),
    tcp(10250),
  );

  policy("metrics-server-to-nodes").allowBetween(
    pod("metrics-server", "metrics-server"),
    allNodes(),
    tcp(10250),
  );

  // minecraft
  policy("minecraft-to-mojang")
    .targets(pod("minecraft", "minecraft"))
    .allowEgressTo(dns("launchermeta.mojang.com"), tcp(443))
    .allowEgressTo(dns("api.minecraftservices.com"), tcp(443))
    .allowEgressTo(dns("sessionserver.mojang.com"), tcp(443));

  // piraeus-operator
  policy("host-to-linstor-affinity-controller").allowBetween(
    host(),
    component("linstor-affinity-controller", "piraeus-operator"),
    tcp(8000),
  );

  policy("linstor-affinity-controller-to-control-plane").allowBetween(
    component("linstor-affinity-controller", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("all-nodes-to-linstor-controller").allowBetween(
    allNodes(),
    component("linstor-controller", "piraeus-operator"),
    tcp(3370),
  );

  policy("linstor-affinity-controller-to-linstor-controller").allowBetween(
    component("linstor-affinity-controller", "piraeus-operator"),
    component("linstor-controller", "piraeus-operator"),
    tcp(3370),
  );

  policy("linstor-controller-to-control-plane").allowBetween(
    component("linstor-controller", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("linstor-controller-to-linstor-satellite").allowBetween(
    component("linstor-controller", "piraeus-operator"),
    component("linstor-satellite", "piraeus-operator"),
    tcp(3366),
  );

  policy("host-to-linstor-controller").allowBetween(
    host(),
    component("linstor-controller", "piraeus-operator"),
    tcp(3370),
  );

  policy("host-to-linstor-csi-controller").allowBetween(
    host(),
    component("linstor-csi-controller", "piraeus-operator"),
    tcp([9808, 9813]),
  );

  policy("linstor-csi-controller-to-control-plane").allowBetween(
    component("linstor-csi-controller", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("linstor-csi-controller-to-linstor-controller").allowBetween(
    component("linstor-csi-controller", "piraeus-operator"),
    component("linstor-controller", "piraeus-operator"),
    tcp(3370),
  );

  policy("linstor-csi-nfs-server-to-linstor-controller").allowBetween(
    component("linstor-csi-nfs-server", "piraeus-operator"),
    component("linstor-controller", "piraeus-operator"),
    tcp(3370),
  );

  policy("linstor-csi-nfs-server-to-control-plane").allowBetween(
    component("linstor-csi-nfs-server", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("linstor-satellite-to-linstor-satellite").allowBetween(
    component("linstor-satellite", "piraeus-operator"),
    component("linstor-satellite", "piraeus-operator"),
    tcp([7000, 7999]),
  );

  policy("host-to-linstor-satellite").allowBetween(
    host(),
    component("linstor-satellite", "piraeus-operator"),
    tcp(3366),
  );

  policy("host-to-piraeus-operator-ha-controller").allowBetween(
    host(),
    component("ha-controller", "piraeus-operator"),
    tcp(8000),
  );

  policy("piraeus-operator-ha-controller-to-control-plane").allowBetween(
    component("ha-controller", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("control-plane-to-piraeus-operator").allowBetween(
    controlPlane(),
    component("piraeus-operator", "piraeus-operator"),
    tcp(9443),
  );

  policy("host-to-piraeus-operator").allowBetween(
    host(),
    component("piraeus-operator", "piraeus-operator"),
    tcp(8081),
  );

  policy("piraeus-operator-to-control-plane").allowBetween(
    component("piraeus-operator", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("piraeus-operator-to-linstor-controller").allowBetween(
    component("piraeus-operator", "piraeus-operator"),
    component("linstor-controller", "piraeus-operator"),
    tcp(3370),
  );

  policy("piraeus-operator-gencert-to-control-plane").allowBetween(
    component("piraeus-operator-gencert", "piraeus-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-piraeus-operator-gencert").allowBetween(
    host(),
    component("piraeus-operator-gencert", "piraeus-operator"),
    tcp(8081),
  );

  // postfix
  policy("postfix-to-mailgun--egress")
    .targets(pod("mail", "postfix"))
    .allowEgressTo(dns("smtp.mailgun.org"), tcp(587));

  // prometheus
  policy("host-to-prometheus").allowBetween(
    host(),
    pod("prometheus", "prometheus"),
    tcp(9090),
  );

  policy("prometheus-to-alertmanager").allowBetween(
    pod("prometheus", "prometheus"),
    pod("alertmanager", "alertmanager"),
    tcp(9093),
  );

  policy("prometheus-to-control-plane").allowBetween(
    pod("prometheus", "prometheus"),
    controlPlane(),
    tcp(6443, 10257, 10259),
  );

  policy("prometheus-to-host").allowBetween(
    pod("prometheus", "prometheus"),
    host(),
    tcp(9100, 10250),
  );

  policy("prometheus-to-kube-state-metrics").allowBetween(
    pod("prometheus", "prometheus"),
    component("metrics", "kube-state-metrics"),
    tcp(8080),
  );

  policy("prometheus-to-nodes").allowBetween(
    pod("prometheus", "prometheus"),
    allNodes(),
    tcp(9100, 10250),
  );

  // prometheus-operator
  policy("prometheus-operator-to-control-plane").allowBetween(
    component("controller", "prometheus-operator"),
    controlPlane(),
    tcp(6443),
  );

  // pvc-restore
  policy("host-to-pvc-restore").allowBetween(
    host(),
    pod("pvc-restore", "pvc-restore"),
    tcp(8081),
  );

  policy("pvc-restore-to-control-plane").allowBetween(
    pod("pvc-restore", "pvc-restore"),
    controlPlane(),
    tcp(6443),
  );

  // router-policy-sync
  policy("host-to-router-policy-sync").allowBetween(
    host(),
    pod("router-policy-sync", "router-policy-sync"),
    tcp(8081),
  );

  policy("router-policy-sync-to-control-plane").allowBetween(
    pod("router-policy-sync", "router-policy-sync"),
    controlPlane(),
    tcp(6443),
  );

  policy("router-policy-sync-to-router--egress")
    .targets(pod("router-policy-sync", "router-policy-sync"))
    .allowEgressTo(dns("router.bulia"), tcp(80));

  // vault
  policy("vault-to-control-plane").allowBetween(
    pod("vault", "vault"),
    controlPlane(),
    tcp(6443),
  );

  policy("vault-to-vault").allowBetween(
    pod("vault", "vault"),
    pod("vault", "vault"),
    tcp(8201),
  );

  // vault-push-secrets
  policy("vault-push-secrets-to-google--egress")
    .targets(pod("vault-push-secrets", "vault-push-secrets"))
    .allowEgressTo(dns("*.googleapis.com"), tcp(443));

  policy("vault-push-secrets-to-vault").allowBetween(
    pod("vault-push-secrets", "vault-push-secrets"),
    pod("vault", "vault"),
    tcp(8200),
  );

  // vault-secrets-operator
  policy("host-to-vault-secrets-operator").allowBetween(
    host(),
    pod("vault-secrets-operator", "vault-secrets-operator"),
    tcp(8081),
  );

  policy("vault-secrets-operator-to-control-plane").allowBetween(
    pod("vault-secrets-operator", "vault-secrets-operator"),
    controlPlane(),
    tcp(6443),
  );

  policy("vault-secrets-operator-to-vault").allowBetween(
    pod("vault-secrets-operator", "vault-secrets-operator"),
    pod("vault", "vault"),
    tcp(8200),
  );

  // vertical-pod-autoscaler
  policy(
    "control-plane-to-vertical-pod-autoscaler-admission-controller",
  ).allowBetween(
    controlPlane(),
    component("admission-controller", "vertical-pod-autoscaler"),
    tcp(8000),
  );

  policy("host-to-vertical-pod-autoscaler-admission-controller").allowBetween(
    host(),
    component("admission-controller", "vertical-pod-autoscaler"),
    tcp(8000, 8944),
  );

  policy(
    "vertical-pod-autoscaler-admission-controller-to-control-plane",
  ).allowBetween(
    component("admission-controller", "vertical-pod-autoscaler"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-vertical-pod-autoscaler-recommender").allowBetween(
    host(),
    component("recommender", "vertical-pod-autoscaler"),
    tcp(8942),
  );

  policy("vertical-pod-autoscaler-recommender-to-control-plane").allowBetween(
    component("recommender", "vertical-pod-autoscaler"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-vertical-pod-autoscaler-updater").allowBetween(
    host(),
    component("updater", "vertical-pod-autoscaler"),
    tcp(8943),
  );

  policy("vertical-pod-autoscaler-updater-to-control-plane").allowBetween(
    component("updater", "vertical-pod-autoscaler"),
    controlPlane(),
    tcp(6443),
  );

  // volsync
  policy("volsync-to-control-plane").allowBetween(
    pod("volsync", "volsync"),
    controlPlane(),
    tcp(6443),
  );

  policy("host-to-volsync").allowBetween(
    host(),
    pod("volsync", "volsync"),
    tcp(8081),
  );

  policy("volsync-mover-to-google--egress")
    .targets(pod("volsync-mover", "*"))
    .allowEgressTo(dns("*.googleapis.com"), tcp(443));

  // general
  // bgp
  policy("router-bgp-to-nodes--ingress")
    .targets(allNodes())
    .allowIngressFrom(cidrs("192.168.32.1/32"), tcp(179));

  policy("nodes-to-router-bgp--egress")
    .targets(allNodes())
    .allowEgressTo(cidrs("192.168.32.1/32"), tcp(179));

  // cilium health
  policy("nodes-to-cilium-health").allowBetween(
    allNodes(),
    allNodes(),
    tcp(4240),
  );

  // dhcp
  policy("nodes-to-router-dhcp--egress")
    .targets(allNodes())
    .allowEgressTo(cidrs("192.168.32.1/32"), udp(67));

  // dns
  policy("nodes-to-router-dns--egress")
    .targets(allNodes())
    .allowEgressTo(cidrs("192.168.88.1/32"), tcp(53), udp(53));

  // geneve
  policy("nodes-to-geneve").allowBetween(allNodes(), allNodes(), udp(6081));

  // health
  policy("nodes-to-health").allowBetween(allNodes(), health());

  // icmp
  policy("nodes-to-icmp").allowBetween(allNodes(), allNodes(), icmpv4(5, 8));

  policy("pods-to-icmp").allowBetween(allNodes(), allPods(), icmpv4(5, 8));

  // image registries
  // NOTE: cilium 1.18.X doesn't support dns-based rules for host policies. for now, allow host-level 0.0.0.0/32:443 egress.
  policy("nodes-to-https--egress")
    .targets(allNodes())
    .allowEgressTo(cidrs("0.0.0.0/0"), tcp(443));

  // kube-apiserver
  policy("nodes-to-kube-apiserver").allowBetween(
    allNodes(),
    controlPlane(),
    tcp(6443),
  );

  policy("world-to-kube-apiserver--ingress")
    .targets(controlPlane())
    .allowIngressFrom(cidrs("192.168.16.0/24", "192.168.17.0/24"), tcp(6443));

  // kubelet
  policy("nodes-to-kubelet").allowBetween(allNodes(), allNodes(), tcp(10250));

  // talos
  policy("nodes-to-talos-apid").allowBetween(
    allNodes(),
    allNodes(),
    tcp(50000),
  );

  policy("world-to-talos-apid--ingress")
    .targets(controlPlane())
    .allowIngressFrom(cidrs("192.168.16.0/24", "192.168.17.0/24"), tcp(50000));

  policy("nodes-to-talos-trustd").allowBetween(
    allNodes(),
    controlPlane(),
    tcp(50001),
  );

  // timeserver
  policy("nodes-to-ntp--egress")
    .targets(allNodes())
    .allowEgressTo(cidrs("162.159.200.1/32", "162.159.200.123/32"), udp(123));

  // gateways
  policy("gateway-public-to-envoy-gateway-controller").allowBetween(
    gateway("public"),
    component("controller", "envoy-gateway"),
    tcp(18000),
  );

  policy("gateway-public-to-minecraft").allowBetween(
    gateway("public"),
    pod("minecraft", "minecraft"),
    tcp(25565),
  );

  policy("world-to-gateway-public--ingress")
    .targets(gateway("public"))
    .allowIngressFrom(cidrs("198.51.100.1/32"), tcp(10443, 25565))
    .syncWithRouter();

  policy("gateway-trusted-to-envoy-gateway-controller").allowBetween(
    gateway("trusted"),
    component("controller", "envoy-gateway"),
    tcp(18000),
  );

  policy("gateway-trusted-to-alertmanager").allowBetween(
    gateway("trusted"),
    pod("alertmanager", "alertmanager"),
    tcp(9093),
  );

  policy("gateway-trusted-to-cilium-hubble-ui").allowBetween(
    gateway("trusted"),
    pod("hubble-ui", "cilium"),
    tcp(8081),
  );

  policy("gateway-trusted-to-grafana").allowBetween(
    gateway("trusted"),
    pod("grafana", "grafana"),
    tcp(3000),
  );

  policy("gateway-trusted-to-minecraft").allowBetween(
    gateway("trusted"),
    pod("minecraft", "minecraft"),
    tcp(25565),
  );

  policy("gateway-trusted-to-prometheus").allowBetween(
    gateway("trusted"),
    pod("prometheus", "prometheus"),
    tcp(9090),
  );

  policy("gateway-trusted-to-tunnel").allowBetween(
    gateway("trusted"),
    pod("tunnel", "tunnel"),
    tcp(8080, 8081),
  );

  policy("gateway-trusted-to-vault").allowBetween(
    gateway("trusted"),
    pod("vault", "vault"),
    tcp(8200),
  );

  policy("world-to-gateway-trusted--ingress")
    .targets(gateway("trusted"))
    .allowIngressFrom(
      cidrs("192.168.16.0/24", "192.168.17.0/24"),
      tcp(10443, 25565),
    )
    .allowIngressFrom(cidrs("192.168.16.13/32"), tcp(8080));

  return chart;
};
