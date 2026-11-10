import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  const security = h.securityContext();

  await ns.helm("https://helm.cilium.io/cilium?version=1.20.4", {
    values: {
      bgpControlPlane: { enabled: true },
      bpf: { masquerade: true },
      cgroup: { automount: { enabled: false }, hostRoot: "/sys/fs/cgroup" },
      clustermesh: { policyDefaultLocalCluster: true },
      cni: { exclusive: false },
      hostFirewall: { enabled: true },
      hubble: {
        metrics: {
          enabled: [
            "dns",
            "drop",
            "tcp",
            "flow",
            "port-distribution",
            "icmp",
            "httpV2:exemplars=true;labelsContext=source_ip,source_namespace,source_workload,destination_ip,destination_namespace,destination_workload,traffic_direction",
          ],
          serviceMonitor: { enabled: true },
        },
        relay: {
          enabled: true,
          podSecurityContext: security.pod,
          prometheus: {
            enabled: true,
            serviceMonitor: { enabled: true },
          },
          securityContext: security.container,
        },
        tls: {
          auto: {
            method: "certmanager",
            certManagerIssuerRef: {
              group: "cert-manager.io",
              kind: "Issuer",
              name: "ca",
            },
          },
        },
        ui: {
          enabled: true,
          backend: { securityContext: security.container },
          frontend: { securityContext: security.container },
          securityContext: security.pod,
        },
      },
      ipam: { mode: "kubernetes" },
      k8sServiceHost: "localhost",
      k8sServicePort: 7445,
      kubeProxyReplacement: true,
      labels:
        "kubernetes\\.io/hostname k8s-app app node-role\\.kubernetes\\.io/control-plane gateway\\.envoyproxy\\.io/owning-gateway-name",
      loadBalancer: { mode: "dsr", dsrDispatch: "geneve" },
      nodeLabels:
        "io\\.cilium\\.k8s\\.policy\\.cluster node-role\\.kubernetes\\.io/control-plane kubernetes\\.io/hostname",
      nodeSelectorLabels: true,
      envoy: {
        prometheus: { serviceMonitor: { enabled: true } },
      },
      operator: {
        podSecurityContext: security.pod,
        prometheus: {
          enabled: true,
          metricsService: true,
          serviceMonitor: { enabled: true },
        },
        securityContext: security.container,
        skipCRDCreation: true,
      },
      policyAuditMode: false,
      prometheus: {
        enabled: true,
        serviceMonitor: { enabled: true },
      },
      policyEnforcementMode: "always",
      rollOutCiliumPods: true,
      tunnelProtocol: "geneve",
      securityContext: {
        capabilities: {
          ciliumAgent: [
            "CHOWN",
            "KILL",
            "NET_ADMIN",
            "NET_RAW",
            "IPC_LOCK",
            "SYS_ADMIN",
            "SYS_RESOURCE",
            "DAC_OVERRIDE",
            "FOWNER",
            "SETGID",
            "SETUID",
            "NET_BIND_SERVICE",
          ],
          cleanCiliumState: ["NET_ADMIN", "SYS_ADMIN", "SYS_RESOURCE"],
        },
      },
      // these chart defaults are null; helm 4 drops a null key instead of rendering it empty like helm 3
      // did. set explicitly so the config checksum matches what's deployed; remove deliberately for leaner defaults.
      debug: { verbose: "" },
      nodePort: { addresses: [] },
      policyCIDRMatchMode: [],
    },
  });

  // the chart doesn't ship these crds
  const crds =
    "https://raw.githubusercontent.com/cilium/cilium/v1.20.4/pkg/k8s/apis/cilium.io/client/crds";
  for (const file of [
    "v2/ciliumbgpadvertisements",
    "v2/ciliumbgpclusterconfigs",
    "v2/ciliumbgpnodeconfigoverrides",
    "v2/ciliumbgpnodeconfigs",
    "v2/ciliumbgppeerconfigs",
    "v2/ciliumcidrgroups",
    "v2/ciliumclusterwideenvoyconfigs",
    "v2/ciliumclusterwidenetworkpolicies",
    "v2/ciliumegressgatewaypolicies",
    "v2/ciliumendpoints",
    "v2/ciliumenvoyconfigs",
    "v2/ciliumidentities",
    "v2/ciliumloadbalancerippools",
    "v2/ciliumlocalredirectpolicies",
    "v2/ciliumnetworkpolicies",
    "v2/ciliumnodeconfigs",
    "v2/ciliumnodes",
    "v2alpha1/ciliumdatapathplugins",
    "v2alpha1/ciliumendpointslices",
    "v2alpha1/ciliumgatewayclassconfigs",
    "v2alpha1/ciliuml2announcementpolicies",
    "v2alpha1/ciliumpodippools",
  ]) {
    await ns.manifest(`${crds}/${file}.yaml`);
  }

  ns.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
      name: "ca",
    },
    spec: {
      commonName: "Cilium CA",
      duration: "87600h",
      isCA: true,
      issuerRef: {
        group: "cert-manager.io",
        kind: "ClusterIssuer",
        name: "self-signed",
      },
      privateKey: {
        rotationPolicy: "Never",
      },
      secretName: "ca-certs",
    },
  });

  ns.add({
    apiVersion: "cert-manager.io/v1",
    kind: "Issuer",
    metadata: {
      name: "ca",
    },
    spec: {
      ca: {
        secretName: "ca-certs",
      },
    },
  });

  ns.add({
    apiVersion: "cilium.io/v2",
    kind: "CiliumLoadBalancerIPPool",
    metadata: {
      name: "default",
    },
    spec: {
      blocks: [
        {
          start: "192.168.33.2",
          stop: "192.168.33.254",
        },
      ],
    },
  });

  ns.add({
    apiVersion: "cilium.io/v2",
    kind: "CiliumBGPAdvertisement",
    metadata: {
      labels: {
        "homelab/bgp-advertisement": "router",
      },
      name: "router",
    },
    spec: {
      advertisements: [
        {
          advertisementType: "Service",
          selector: {
            matchExpressions: [
              {
                key: "homelab/does-not-exist",
                operator: "DoesNotExist",
              },
            ],
          },
          service: {
            addresses: ["LoadBalancerIP"],
          },
        },
      ],
    },
  });

  ns.add({
    apiVersion: "cilium.io/v2",
    kind: "CiliumBGPPeerConfig",
    metadata: {
      name: "router",
    },
    spec: {
      families: [
        {
          advertisements: {
            matchLabels: {
              "homelab/bgp-advertisement": "router",
            },
          },
          afi: "ipv4",
          safi: "unicast",
        },
      ],
      gracefulRestart: {
        enabled: true,
        restartTimeSeconds: 15,
      },
      timers: {
        connectRetryTimeSeconds: 5,
        holdTimeSeconds: 9,
        keepAliveTimeSeconds: 3,
      },
    },
  });

  ns.add({
    apiVersion: "cilium.io/v2",
    kind: "CiliumBGPClusterConfig",
    metadata: {
      name: "default",
    },
    spec: {
      bgpInstances: [
        {
          localASN: 64512,
          localPort: 179,
          name: "default",
          peers: [
            {
              name: "router",
              peerASN: 64512,
              peerAddress: "192.168.32.1",
              peerConfigRef: {
                name: "router",
              },
            },
          ],
        },
      ],
    },
  });

  const advisory = { advisory: true };
  ns.vpa({ kind: "DaemonSet", name: "cilium" }, advisory);
  ns.vpa({ kind: "DaemonSet", name: "cilium-envoy" }, advisory);
  ns.vpa({ kind: "Deployment", name: "cilium-operator" }, advisory);
  ns.vpa({ kind: "Deployment", name: "hubble-relay" });
  ns.vpa({ kind: "Deployment", name: "hubble-ui" });

  ns.grpcRoute("infrastructure", "flows.fiola.dev", { timeout: "0s" }).match(
    { kind: "Service", name: "hubble-relay" },
    80,
  );
};

export const network: NetworkFunction = (n) => {
  const ciliumHubbleRelay = n.subject(
    "cilium-hubble-relay",
    pod("hubble-relay", "cilium"),
  );
  const ciliumHubbleUi = n.subject(
    "cilium-hubble-ui",
    pod("hubble-ui", "cilium"),
  );

  ciliumHubbleRelay.to(n.nodes, tcp(4244));
  n.host.to(ciliumHubbleRelay, tcp(4222));
  n.ref("gateway-infrastructure").to(ciliumHubbleRelay, tcp(4245));
  n.ref("prometheus").to(ciliumHubbleRelay, tcp(9966));

  ciliumHubbleUi
    .to(ciliumHubbleRelay, tcp(4245))
    .to(n.kubeApiServer, tcp(6443));
  n.host.to(ciliumHubbleUi, tcp(8081));
};
