import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  ClusterIssuer,
} from "../resources/cert-manager/cert-manager.io";
import { Namespace } from "../resources/k8s/k8s";
import {
  BootstrapCallback,
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodRequests } from "../utils/getPodRequests";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const chartData = {
  chart: "cilium",
  version: "1.16.3",
  repo: "https://helm.cilium.io/",
};

const baseChartValues = {
  cgroup: {
    automount: {
      // talos linux setting
      enabled: false,
    },
    // talos linux setting
    hostRoot: "/sys/fs/cgroup",
  },
  hubble: {
    // disables the hubble relay (which disables ca generation - is re-enabled if not bootstrapping)
    enabled: false,
  },
  ipam: {
    // talos linux setting
    mode: "kubernetes",
  },
  // talos linux setting
  k8sServiceHost: "localhost",
  // talos linux setting
  k8sServicePort: 7445,
  // use cilium to fully replace kube-proxy
  kubeProxyReplacement: true,
  // give cilium agent appropriate resources
  resources: getPodRequests({ cpu: 1000, mem: 1000 }),
  // talos linux setting
  securityContext: {
    capabilities: {
      // talos linux setting
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
      ],
      // talos linux setting
      cleanCiliumState: ["NET_ADMIN", "SYS_ADMIN", "SYS_RESOURCE"],
    },
  },
};

const bootstrap: BootstrapCallback = async (app) => {
  const chart = new Chart(app, "cilium", { namespace: "cilium" });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: { ...getPrivilegedNamespaceLabels() },
    },
  });

  new Helm(chart, "helm", {
    ...chartData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseChartValues,
    },
  });

  return chart;
};

const manifests: ManifestsCallback = async (app) => {
  const {
    CiliumClusterwideNetworkPolicy,
    CiliumLoadBalancerIpPool,
    CiliumL2AnnouncementPolicy,
    CiliumBgpPeeringPolicy,
  } = await import("../resources/cilium/cilium.io");
  const { createNetworkPolicy } = await import("../utils/createNetworkPolicy");

  const chart = new Chart(app, "cilium", {
    namespace: "cilium",
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: { ...getPrivilegedNamespaceLabels() },
    },
  });

  const cert = new Certificate(chart, "certificate", {
    metadata: {
      namespace: "cert-manager",
      name: "cilium",
    },
    spec: {
      isCa: true,
      commonName: "cilium",
      // NOTE: secretName intentionally matches metadata.name
      secretName: "cilium",
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        size: 256,
      },
      issuerRef: {
        name: "root",
        kind: "ClusterIssuer",
        group: "cert-manager.io",
      },
    },
  });

  const issuer = new ClusterIssuer(chart, "issuer", {
    metadata: {
      namespace: "cert-manager",
      name: "cilium",
    },
    spec: {
      ca: {
        secretName: cert.name,
      },
    },
  });

  new Helm(chart, "helm", {
    ...chartData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      ...baseChartValues,
      bgpControlPlane: {
        // enable use of bgp to advertise routes
        enabled: true,
      },
      bpf: {
        // masquerade via bpf (better performance)
        masquerade: true,
        // do not aggregate flow traces
        monitorAggregation: "none",
      },
      hubble: {
        // enables hubble metrics
        enabled: true,
        metrics: {
          // list of metrics to collect (if not provided - the hubble-peer port on the cilium deployment won't exist)
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
          // enables the hubble relay
          enabled: true,
        },
        tls: {
          auto: {
            // configures hubble to use cert-manager to auto-generate certificates
            certManagerIssuerRef: {
              group: issuer.apiGroup,
              kind: issuer.kind,
              name: issuer.name,
            },
            enabled: true,
            method: "certmanager",
          },
        },
        ui: {
          backend: {
            resources: getPodRequests({ mem: 200 }),
          },
          // enables the hubble ui
          enabled: true,
          ingress: {
            // enable ingress to the frontend
            enabled: true,
            // use cluster ingress class
            className: getIngressClassName(),
            // give the ingress an accessible domain
            hosts: ["cilium.bulia"],
          },
        },
      },
      ingressController: {
        // enable the ingress controller
        enabled: true,
        // share the same ip per ingress resource
        loadbalancerMode: "shared",
      },
      loadBalancer: {
        // use direct server return mode to preserve client ip when connecting to loadbalancer services
        mode: "dsr",
        // use geneve for the load balancer (NOTE: requires tunnelProtocol to be set)
        dsrDispatch: "geneve",
      },
      // deny all traffic not included in a network policy
      policyEnforcementMode: "always",
      // restart cilium pods on config map change
      rollOutCiliumPods: true,
      // use geneve as a tunnel protocol (required for load balancer dsr)
      tunnelProtocol: "geneve",
    },
  });

  new CiliumLoadBalancerIpPool(chart, "ip-pool", {
    metadata: { namespace: chart.namespace, name: "default" },
    spec: {
      blocks: [
        {
          start: "192.168.33.10",
          stop: "192.168.33.254",
        },
      ],
    },
  });

  new CiliumBgpPeeringPolicy(chart, "peering-policy", {
    metadata: { namespace: chart.namespace, name: "default" },
    spec: {
      virtualRouters: [
        {
          exportPodCidr: true,
          localAsn: 64512,
          neighbors: [
            {
              peerAddress: "192.168.32.1/32",
              peerAsn: 64512,
            },
          ],
          serviceSelector: {
            matchExpressions: [
              {
                // this is required to select all services
                key: "bfiola.dev/not-set",
                operator: "NotIn" as any,
                values: ["not-set"],
              },
            ],
          },
        },
      ],
    },
  });

  new CiliumClusterwideNetworkPolicy(chart, "default", {
    metadata: {
      name: `default`,
    },
    specs: [
      {
        description: "kube-dns",
        endpointSelector: {
          matchLabels: {
            "io.kubernetes.pod.namespace": "kube-system",
            "k8s-app": "kube-dns",
          },
        },
        ingress: [
          {
            fromEndpoints: [{}],
            toPorts: [
              {
                ports: [{ port: "53", protocol: "ANY" as any }],
              },
            ],
          },
          {
            fromEndpoints: [
              {
                matchLabels: {
                  "io.kubernetes.pod.namespace": "kube-prometheus",
                  "bfiola.dev/pod-name": "prometheus-kube-prometheus",
                },
              },
            ],
            toPorts: [
              {
                ports: [{ port: "9153", protocol: "TCP" as any }],
              },
            ],
          },
        ],
        egress: [
          {
            toEntities: ["world" as any],
            toPorts: [
              {
                ports: [{ port: "53", protocol: "ANY" as any }],
              },
            ],
          },
          {
            toEntities: ["kube-apiserver" as any],
            toPorts: [
              {
                ports: [{ port: "6443", protocol: "TCP" as any }],
              },
            ],
          },
        ],
      },
      {
        description: "all pods",
        endpointSelector: {},
        egress: [
          {
            toEndpoints: [
              {
                matchLabels: {
                  "io.kubernetes.pod.namespace": "kube-system",
                  "k8s-app": "kube-dns",
                },
              },
            ],
            toPorts: [
              {
                ports: [{ port: "53", protocol: "ANY" as any }],
                rules: { dns: [{ matchPattern: "*" }] },
              },
            ],
          },
        ],
      },
      {
        description: "health",
        endpointSelector: { matchLabels: { "reserved:health": "" } },
        ingress: [{ fromEntities: ["remote-node" as any] }],
        egress: [{ toEntities: ["remote-node" as any] }],
      },
      {
        description: "ingress",
        endpointSelector: {
          matchExpressions: [
            {
              key: "reserved:ingress",
              operator: "Exists" as any,
            },
          ],
        },
        ingress: [{ fromCidr: ["192.168.0.0/16"] }],
        egress: [{ toEntities: ["cluster" as any] }],
      },
    ],
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: {
        pod: "hubble-relay",
      },
      to: {
        entity: "host",
        ports: [[4244, "tcp"]],
      },
    },
    {
      from: {
        pod: "hubble-relay",
      },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: {
        pod: "hubble-ui",
      },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: {
        pod: "hubble-relay",
      },
      to: {
        entity: "remote-node",
        ports: [[4244, "tcp"]],
      },
    },

    {
      from: {
        pod: "hubble-ui",
      },
      to: { pod: "hubble-relay", ports: [[4245, "tcp"]] },
    },
    {
      from: {
        entity: "ingress",
      },
      to: { pod: "hubble-ui", ports: [[8081, "tcp"]] },
    },
  ]);

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const resources = [
    ["v2alpha1", "ciliumbgpadvertisements"],
    ["v2alpha1", "ciliumbgpclusterconfigs"],
    ["v2alpha1", "ciliumbgpnodeconfigoverrides"],
    ["v2alpha1", "ciliumbgpnodeconfigs"],
    ["v2alpha1", "ciliumbgppeerconfigs"],
    ["v2alpha1", "ciliumbgppeeringpolicies"],
    ["v2alpha1", "ciliumcidrgroups"],
    ["v2", "ciliumclusterwideenvoyconfigs"],
    ["v2", "ciliumclusterwidenetworkpolicies"],
    ["v2", "ciliumendpoints"],
    ["v2", "ciliumenvoyconfigs"],
    ["v2", "ciliumexternalworkloads"],
    ["v2", "ciliumidentities"],
    ["v2alpha1", "ciliuml2announcementpolicies"],
    ["v2alpha1", "ciliumloadbalancerippools"],
    ["v2", "ciliumnetworkpolicies"],
    ["v2alpha1", "ciliumnodeconfigs"],
    ["v2", "ciliumnodes"],
    ["v2alpha1", "ciliumpodippools"],
  ];
  const manifests: string[] = [];
  for (const [resourceVersion, resource] of resources) {
    const url = `https://raw.githubusercontent.com/cilium/cilium/v${chartData.version}/pkg/k8s/apis/cilium.io/client/crds/${resourceVersion}/${resource}.yaml`;
    const manifest = await fetch(url).then((r) => r.text());
    manifests.push(manifest);
  }
  await writeFile(manifestFile, manifests.join("\n"));
};

export default async function (context: CliContext) {
  context.bootstrap(bootstrap);
  context.manifests(manifests);
  context.resources(resources);
}
