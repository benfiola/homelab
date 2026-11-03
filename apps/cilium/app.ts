import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://helm.cilium.io/cilium?version=1.20.4", {
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
        },
        relay: {
          enabled: true,
          podSecurityContext: {
            fsGroup: 65534,
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
            seccompProfile: { type: "RuntimeDefault" },
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"], add: [] },
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
          },
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
          backend: {
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"], add: [] },
              runAsNonRoot: true,
              runAsUser: 65534,
              runAsGroup: 65534,
            },
          },
          frontend: {
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"], add: [] },
              runAsNonRoot: true,
              runAsUser: 65534,
              runAsGroup: 65534,
            },
          },
          securityContext: {
            fsGroup: 65534,
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
            seccompProfile: { type: "RuntimeDefault" },
          },
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
      operator: {
        podSecurityContext: {
          fsGroup: 65534,
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
          seccompProfile: { type: "RuntimeDefault" },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"], add: [] },
          runAsNonRoot: true,
          runAsUser: 65534,
          runAsGroup: 65534,
        },
        skipCRDCreation: true,
      },
      policyAuditMode: false,
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
      // these chart defaults are null, and the chart only renders them when the key exists. helm 3
      // rendered them as empty values and helm 4 drops them. they are set explicitly so the rendered
      // config (and the config checksum that rolls the agents) matches what is deployed; remove them,
      // deliberately, to let cilium roll out the leaner config.
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
    h.manifest(`${crds}/${file}.yaml`);
  }

  h.add({
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

  h.add({
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

  h.add({
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

  h.add({
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

  h.add({
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

  h.add({
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

  h.namespace({ privileged: true });

  const advisory = { advisory: true };
  h.vpa({ kind: "DaemonSet", name: "cilium" }, advisory);
  h.vpa({ kind: "DaemonSet", name: "cilium-envoy" }, advisory);
  h.vpa({ kind: "Deployment", name: "cilium-operator" }, advisory);
  h.vpa({ kind: "Deployment", name: "hubble-relay" });
  h.vpa({ kind: "Deployment", name: "hubble-ui" });

  h.grpcRoute("infrastructure", "flows.fiola.dev", { timeout: "0s" }).match(
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
  ciliumHubbleUi
    .to(ciliumHubbleRelay, tcp(4245))
    .to(n.kubeApiServer, tcp(6443));
  n.host.to(ciliumHubbleUi, tcp(8081));
  n.ref("gateway-infrastructure").to(ciliumHubbleRelay, tcp(4245));
};
