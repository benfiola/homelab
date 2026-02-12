import { Include } from "cdk8s";
import {
  CiliumBgpAdvertisementSpecAdvertisementsServiceAddresses as Addresses,
  CiliumBgpAdvertisementSpecAdvertisementsAdvertisementType as AdvertisementType,
  CiliumBgpPeerConfigSpecFamiliesAfi as AFI,
  CiliumBgpAdvertisement,
  CiliumBgpClusterConfig,
  CiliumBgpPeerConfig,
  CiliumBgpAdvertisementSpecAdvertisementsSelectorMatchExpressionsOperator as Operator,
  CiliumBgpPeerConfigSpecFamiliesSafi as SAFI,
} from "../../../assets/cilium/cilium.io";
import {
  Chart,
  findApiObject,
  getField,
  getSecurityContext,
  Helm,
  HttpRoute,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Include(chart, `${id}-crds`, {
    url: context.getAsset("crds.yaml"),
  });

  new Namespace(chart, { privileged: true });

  const securityContext = getSecurityContext();

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    bgpControlPlane: {
      enabled: true,
    },
    bpf: {
      masquerade: true,
    },
    cgroup: {
      automount: {
        enabled: false,
      },
      hostRoot: "/sys/fs/cgroup",
    },
    clustermesh: {
      policyDefaultLocalCluster: true,
    },
    hostFirewall: {
      enabled: true,
    },
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
        podSecurityContext: securityContext.pod,
        securityContext: securityContext.container,
      },
      ui: {
        enabled: true,
        podSecurityContext: securityContext.pod,
        securityContext: securityContext.container,
      },
    },
    ipam: {
      mode: "kubernetes",
    },
    k8sServiceHost: "localhost",
    k8sServicePort: 7445,
    kubeProxyReplacement: true,
    labels:
      "kubernetes\\.io/hostname k8s-app node-role\\.kubernetes\\.io/control-plane gateway\\.envoyproxy\\.io/owning-gateway-name",
    loadBalancer: {
      mode: "dsr",
      dsrDispatch: "geneve",
    },
    nodeLabels:
      "io\\.cilium\\.k8s\\.policy\\.cluster node-role\\.kubernetes\\.io/control-plane kubernetes\\.io/hostname",
    nodeSelectorLabels: true,
    operator: {
      podSecurityContext: securityContext.pod,
      securityContext: securityContext.container,
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
  });

  const bgpAdvertisement = new CiliumBgpAdvertisement(
    chart,
    `${id}-bgp-advertisement`,
    {
      metadata: {
        name: "router",
        labels: {
          "homelab/bgp-advertisement": "router",
        },
      },
      spec: {
        advertisements: [
          {
            advertisementType: AdvertisementType.SERVICE,
            selector: {
              matchExpressions: [
                {
                  key: "homelab/does-not-exist",
                  operator: Operator.DOES_NOT_EXIST,
                },
              ],
            },
            service: {
              addresses: [Addresses.LOAD_BALANCER_IP],
            },
          },
        ],
      },
    },
  );

  const bgpPeerConfig = new CiliumBgpPeerConfig(
    chart,
    `${id}-bgp-peer-config`,
    {
      metadata: {
        name: "router",
      },
      spec: {
        families: [
          {
            afi: AFI.IPV4,
            safi: SAFI.UNICAST,
            advertisements: {
              matchLabels: getField(bgpAdvertisement, "metadata.labels"),
            },
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
    },
  );

  new CiliumBgpClusterConfig(chart, `${id}-bgp-cluster-config`, {
    metadata: {
      name: "default",
    },
    spec: {
      bgpInstances: [
        {
          localAsn: 64512,
          localPort: 179,
          name: "default",
          peers: [
            {
              name: "router",
              peerAddress: "192.168.32.1",
              peerAsn: 64512,
              peerConfigRef: {
                name: bgpPeerConfig.name,
              },
            },
          ],
        },
      ],
    },
  });

  new HttpRoute(chart, ["trusted"], "cilium.bulia.dev").match(
    findApiObject(chart, {
      apiVersion: "v1",
      kind: "Service",
      name: "hubble-ui",
    }),
    80,
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "cilium",
    }),
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "cilium-envoy",
    }),
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "cilium-operator",
    }),
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "hubble-relay",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "hubble-ui",
    }),
  );

  return chart;
};
