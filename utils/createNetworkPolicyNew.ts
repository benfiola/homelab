import { Chart } from "cdk8s";
import { CiliumClusterwideNetworkPolicy } from "../resources/cilium/cilium.io";
import { getPodLabels } from "./getPodLabels";

/**
 * Protocol defines the protocol used by a given port
 */
type Protocol = "any" | "tcp" | "udp";

/**
 * Port defines a single port + protocol (e.g., [5432, "tcp"] is TCP on port 5432)
 */
type Port = [number, Protocol];

/**
 * PortRange defines a port range + protocol (e.g., [[1, 100], "tcp"] is TCP on ports 1-100
 */
type PortRange = [[number, number], Protocol];

/**
 * PortLike expresses the various ways a port can be expressed
 */
type PortLike = Port | PortRange;

/**
 * PodTargetDefs is a named grouping of pod ports by label
 */
type PodTargetDefs = { [Label: string]: PortLike[] };

/**
 * NamespaceTargetDefs is a mapping of a namespace's pods to pod targets.
 */
type NamespaceTargetDefs = { [Pod: string]: PodTargetDefs };

/**
 * CidrTarget is a CIDR-based ACL target
 */
type CidrTarget = {
  cidr: string;
};

/**
 * Typeguard
 *
 * @param obj the object to test
 * @returns true if obj is a CidrTarget
 */
const isCidrTarget = (obj: any): obj is CidrTarget => {
  return obj["cidr"] !== undefined;
};

/**
 * DnsTarget is a DNS-based ACL target
 */
type DnsTarget = {
  dns: string;
};

/**
 * Typeguard
 *
 * @param obj the object to test
 * @returns true if obj is a DnsTarget
 */
const isDnsTarget = (obj: any): obj is DnsTarget => {
  return obj["dns"] !== undefined;
};

/**
 * EndpointTarget is an endpoint-based ACL target.  Endpoints are generally label selectors for pods.
 */
type EndpointTarget = {
  endpoint: Record<string, string>;
};

/**
 * Typeguard
 *
 * @param obj the object to test
 * @returns true if obj is a EndpointTarget
 */
const isEndpointTarget = (obj: any): obj is EndpointTarget => {
  return obj["endpoint"] !== undefined;
};

/**
 * EntityValue represents any of the known cilium entity values.
 * See: https://docs.cilium.io/en/stable/security/policy/language/#entities-based
 */
type EntityValue =
  | "cluster"
  | "host"
  | "ingress"
  | "kube-apiserver"
  | "remote-node";

/**
 * EntityTarget is an entity-based ACL target.
 * See: EntityValue
 */
type EntityTarget = {
  entity: EntityValue;
};

/**
 * Typeguard
 *
 * @param obj the object to test
 * @returns true if obj is a EntityTarget
 */
const isEntityTarget = (obj: any): obj is EntityTarget => {
  return obj["entity"] !== undefined;
};

/**
 * WithPorts is a mixin for targets that additionally adds port information.
 * Generally, ACL sources do not require port data, but ACL destinations do.
 */
type WithPorts = {
  ports: PortLike[];
};

/**
 * SrcTarget represents all valid targets for a source ACL connection.
 */
type SrcTarget = EndpointTarget | EntityTarget;

/**
 * DstTarget represents all valid targets for a destination ACL connection (and includes port data).
 */
type DstTarget = (CidrTarget | DnsTarget | EndpointTarget | EntityTarget) &
  WithPorts;

/**
 * PodTargetMapProps are additional props for the PodTargetMap.
 */
type PodTargetMapProps = {
  (): EndpointTarget; // calling the target map should return a target for the pod itself
};

/**
 * PodTargetMap is a mapping of labels to destination endpoint targets.
 * Calling the PodTargetMap returns an endpoint target for the pod itself.
 */
type PodTargetMap<Defs extends PodTargetDefs> = {
  [Label in keyof Defs as Exclude<
    Label,
    keyof PodTargetMapProps
  >]: EndpointTarget & WithPorts;
} & PodTargetMapProps;

/**
 * NamespaceTargetMapProps are additional props for the NamespaceTargetMap
 */
type NamespaceTargetMapProps = {
  (): EndpointTarget;
};

/**
 * NamespaceTargetMap is a mapping of labels to PodTargetMaps
 * Calling the NamespaceTargetMap returns an endpoint target for the namespace itself.
 */
type NamespaceTargetMap<Defs extends NamespaceTargetDefs> = {
  [Pod in keyof Defs as Exclude<
    Pod,
    keyof NamespaceTargetMapProps
  >]: PodTargetMap<Defs[Pod]>;
} & NamespaceTargetMapProps;

/**
 * Creates a network policy target that can be used to (later) construct network policies.
 * Each app can define its own network policy targets that other apps can import and use to construct ACLs.
 *
 * @param namespace the namespace for these policy targets
 * @param defs the definitions of the pod and labelled port targets
 * @returns a NamespaceTargetMap
 */
export const createNetworkPolicyTarget = <Defs extends NamespaceTargetDefs>(
  namespace: string,
  defs: Defs
) => {
  const namespaceTarget = {
    endpoint: { "io.kubernetes.pod.namespace": namespace },
    type: "endpoint",
  };
  const namespaceTargetMap: any = () => namespaceTarget;
  Object.entries(defs).map(([pod, podDefs]: [string, PodTargetDefs]) => {
    const podTarget = {
      endpoint: {
        ...getPodLabels(pod),
      },
      type: "endpoint",
    };
    const podTargetMap: any = () => podTarget;
    namespaceTargetMap[pod] = podTargetMap;
    Object.entries(podDefs).map(([label, ports]: [string, PortLike[]]) => {
      podTargetMap[label] = {
        ...podTarget,
        ports,
      };
    });
  });
  return namespaceTargetMap as NamespaceTargetMap<Defs>;
};

/**
 * NetworkPolicyDef represents a single source-destination ACL connection between two targets.
 */
type NetworkPolicyDef = [SrcTarget, DstTarget];

/**
 * Creates a CiliumClusterwideNetworkPolicy containing a collection of network policy definitions.
 *
 * @param chart the chart to attach the network policy resource to
 * @param id the id of the network policy resource
 * @param defs the network policy definitions
 * @returns a CiliumClusterwideNetworkPolicy
 */
export const createNetworkPolicy = (
  chart: Chart,
  name: string,
  defs: NetworkPolicyDef[]
) => {
  const specs: any = [];
  defs.map(([src, dest]) => {
    const ports: any[] = [];
    for (const destPort of dest.ports) {
      let startPort;
      let endPort;
      const protocol = destPort[1].toUpperCase();
      if (Array.isArray(destPort[0])) {
        startPort = destPort[0][0];
        endPort = destPort[0][1];
      } else {
        startPort = destPort[0];
      }
      ports.push({
        port: `${startPort}`,
        endPort,
        protocol,
      });
    }

    if (isEndpointTarget(src)) {
      const egress: any = {};
      const spec = {
        endpointSelector: { matchLabels: src.endpoint },
        egress: [egress],
        toPorts: [{ ports }],
      };
      if (isCidrTarget(dest)) {
        egress["toCIDR"] = [dest.cidr];
      } else if (isDnsTarget(dest)) {
        egress["toFQDNs"] = { matchPattern: dest.dns };
      } else if (isEndpointTarget(dest)) {
        egress["toEndpoints"] = { matchLabels: dest.endpoint };
      } else if (isEntityTarget(dest)) {
        egress["toEntities"] = [dest.entity];
      }
      specs.push(spec);
    }

    if (isEndpointTarget(dest)) {
      const ingress: any = {};
      const spec = {
        endpointSelector: { matchLabels: dest.endpoint },
        egress: [ingress],
        toPorts: [{ ports }],
      };
      if (isCidrTarget(src)) {
        ingress["fromCIDR"] = [src.cidr];
      } else if (isDnsTarget(src)) {
        ingress["fromFQDNs"] = { matchPattern: src.dns };
      } else if (isEndpointTarget(src)) {
        ingress["fromEndpoints"] = { matchLabels: src.endpoint };
      } else if (isEntityTarget(src)) {
        ingress["fromEntities"] = [src.entity];
      }
      specs.push(spec);
    }
  });
  return new CiliumClusterwideNetworkPolicy(chart, `ccnp-${name}`, {
    metadata: { name },
    specs,
  });
};
