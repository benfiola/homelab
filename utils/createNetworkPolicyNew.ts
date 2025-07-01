import { Chart } from "cdk8s";
import { CiliumClusterwideNetworkPolicy } from "../resources/cilium/cilium.io";
import { getPodLabels } from "./getPodLabels";

/**
 * Protocol defines a port's protocol
 */
type Protocol = "any" | "tcp" | "udp";

/**
 * Port defines a port number and protocol as a tuple.
 */
type Port = [number, Protocol];

/**
 * PortRange defines a start port, end port and a protocol as a tuple.
 */
type PortRange = [number, number, Protocol];

/**
 * SomePort represents the different ways to express a port-like value.
 */
type SomePort = Port | PortRange;

/**
 * PortsMap represents a labelled port collection as stored within a Target.
 */
type PortsMap = Record<string, SomePort[] | SomePort>;

/**
 * BaseTarget defines common fields between all targets.
 */
interface BaseTarget<PM extends PortsMap> {
  ports: PM;
}

/**
 * CidrTarget represents a CIDR-based ACL rule
 */
interface CidrTarget<PM extends PortsMap> extends BaseTarget<PM> {
  cidr: string;
}

/**
 * Type guard that ensures an object is of type CidrTarget
 *
 * @param v an object
 * @returns true if the object is of type CidrTarget
 */
const isCidrTarget = (v: any): v is CidrTarget<PortsMap> => {
  return v["cidr"] !== undefined;
};

/**
 * DnsTarget represents a DNS-based ACL rule
 */
interface DnsTarget<PM extends PortsMap> extends BaseTarget<PM> {
  dns: string;
}

/**
 * Type guard that ensures an object is of type DnsTarget
 *
 * @param v an object
 * @returns true if the object is of type DnsTarget
 */
const isDnsTarget = (v: any): v is DnsTarget<PortsMap> => {
  return v["dns"] !== undefined;
};

/**
 * EndpointTarget represents a endpoint-based ACL rule.
 * Endpoints often represent either a namespace or a pod within a cluster.
 */
interface EndpointTarget<PM extends PortsMap> extends BaseTarget<PM> {
  endpoint: Record<string, string>;
}

/**
 * Type guard that ensures an object is of type EndpointTarget
 *
 * @param v an object
 * @returns true if the object is of type EndpointTarget
 */
const isEndpointTarget = (v: any): v is EndpointTarget<PortsMap> => {
  return v["endpoint"] !== undefined;
};

/**
 * EntityValue is known entity constants
 * See: https://docs.cilium.io/en/stable/security/policy/language/#entities-based
 */
type EntityValue =
  | "cluster"
  | "host"
  | "ingress"
  | "kube-apiserver"
  | "remote-node";

/**
 * EntityTarget represents a entity-based ACL rule.
 * Entities represent special entities within a cluster (defined by Cilium).
 */
interface EntityTarget<PM extends PortsMap> extends BaseTarget<PM> {
  entity: EntityValue;
}

/**
 * Type guard that ensures an object is of type EntityTarget
 *
 * @param v an object
 * @returns true if the object is of type EntityTarget
 */
const isEntityTarget = (v: any): v is EntityTarget<PortsMap> => {
  return v["entity"] !== undefined;
};

/**
 * Target is the union of all *Target types.
 */
type Target<PM extends PortsMap> =
  | CidrTarget<PM>
  | DnsTarget<PM>
  | EndpointTarget<PM>
  | EntityTarget<PM>;

/**
 * SomeTarget is a non-generic version of Target.
 */
type SomeTarget = Target<PortsMap>;

/**
 * Helper method that ensures a properly typed target is returned
 *
 * @param target a target
 * @returns a type-constrained target
 */
const createTarget = <PM extends PortsMap, T extends Target<PM>>(
  target: T
): T => target;

/**
 * Helper method that returns a namespace target (defining common labels).
 *
 * @param namespace the namespace
 * @param ports the ports to attach to this target
 * @returns a namespace endpoint target
 */
const createNamespaceTarget = <PM extends PortsMap = {}>(
  namespace: string,
  ports?: PM
) => {
  return createTarget({
    endpoint: {
      "io.kubernetes.pod.namespace": namespace,
    },
    ports: (ports || {}) as PM,
  });
};

/**
 * Helper method that returns a namespace target (defining common labels).
 *
 * @param namespace the namespace.  if null, matches pods across all namespaces.
 * @param pod the pod name
 * @param ports the ports to attach to this target
 * @returns a pod endpoint target
 */
const createPodTarget = <PM extends PortsMap = {}>(
  namespace: string | null,
  pod: string,
  ports?: PM
) => {
  let endpoint: Record<string, string> = getPodLabels(pod);
  if (namespace !== null) {
    endpoint["io.kubernetes.pod.namespace"] = namespace;
  }
  return createTarget({
    endpoint,
    ports: (ports || {}) as PM,
  });
};

/**
 * TargetBuilder helps build targets.  Primarily provides common helper target methods
 * without requiring importing all long-named functions.
 */
interface TargetBuilder {
  target: typeof createTarget;
  pod: typeof createPodTarget;
  namespace: typeof createNamespaceTarget;
}

/**
 * Callback supplied to createTargets
 */
type TargetBuilderCallback<RV extends any> = (b: TargetBuilder) => RV;

/**
 * Builder method that simplifies target creation
 * @param cb callback used to build targets
 * @returns the return value of the callback
 */
export const createTargets = <RV extends any>(
  cb: TargetBuilderCallback<RV>
): RV => {
  const builder: TargetBuilder = {
    namespace: createNamespaceTarget,
    pod: createPodTarget,
    target: createTarget,
  };
  return cb(builder);
};

/**
 * TargetPortKeys helps extract the port labels for the given target
 */
type TargetPortKeys<T extends SomeTarget> = keyof T["ports"];

/**
 * Rule contains a source, a destination and the ports that comprise an ACL
 */
type Rule = [SomeTarget, SomeTarget, SomePort[]];

/**
 * Helper method that simplifies the creation of rules by referencing known port labels for the destination.
 *
 * @param src the source target
 * @param dst the destination target
 * @param portKeys the port keys to include in the ACL
 * @returns a rule
 */
const createRule = <PM extends PortsMap, Dst extends Target<PM>>(
  src: SomeTarget,
  dst: Dst,
  ...portKeys: TargetPortKeys<Dst>[]
) => {
  if (portKeys.length === 0) {
    portKeys.push("default");
  }

  const ports: SomePort[] = [];
  for (const portKey of Array.from(new Set(portKeys))) {
    const val = dst.ports[portKey];
    if (val === undefined) {
      throw new Error(
        `port key '${portKey.toString()}' not in target ${JSON.stringify(dst)}`
      );
    }

    if (val.length === 0) {
      continue;
    }

    if (Array.isArray(val[0])) {
      ports.push(...(val as SomePort[]));
    } else {
      ports.push(val as SomePort);
    }
  }

  return [src, dst, ports] as Rule;
};

/**
 * NetworkPolicyBuilder helps create network policies
 */
interface NetworkPolicyBuilder {
  rule: typeof createRule;
  target: typeof createTarget;
}

/**
 * NetworkPolicyCallback is invoked by createNetworkPolicy and helps build a network policy.
 */
type NetworkPolicyCallback = (b: NetworkPolicyBuilder) => void;

/**
 * Helper method to create a network policy with the given rule list.
 *
 * @param chart the chart to attach the k8s resource to
 * @param rules the list of rules that belong to the network policy
 * @returns a CiliumClusterwideNetworkPolicy resource
 */
const _createNetworkPolicy = (chart: Chart, rules: Rule[]) => {
  let specs: any = [];

  rules.map((rule) => {
    const ports: any = [];
    const rulePorts = rule[2];
    rulePorts.map((rulePort) => {
      let startPort;
      let endPort;
      let protocol;

      if (rulePort.length === 2) {
        startPort = rulePort[0];
        protocol = rulePort[1];
      } else if (rulePort.length === 3) {
        startPort = rulePort[0];
        endPort = rulePort[1];
        protocol = rulePort[2];
      } else {
        throw new Error(`invalid port: ${JSON.stringify(rulePort)}`);
      }

      ports.push({
        port: `${startPort}`,
        endPort,
        protocol: protocol.toUpperCase(),
      });
    });

    const src = rule[0];
    const dst = rule[1];

    if (isEndpointTarget(src)) {
      let egress: any = { toPorts: [{ ports }] };
      const spec = {
        egress: [egress],
        endpointSelector: { matchLabels: src.endpoint },
      };

      if (isCidrTarget(dst)) {
        egress["toCIDR"] = [dst.cidr];
      } else if (isDnsTarget(dst)) {
        egress["toFqdNs"] = [{ matchPattern: dst.dns }];
      } else if (isEndpointTarget(dst)) {
        egress["toEndpoints"] = [{ matchLabels: dst.endpoint }];
      } else if (isEntityTarget(dst)) {
        egress["toEntities"] = [dst.entity];
      } else {
        throw new Error(`invalid dst target: ${JSON.stringify(dst)}`);
      }

      specs.push(spec);
    }

    if (isEndpointTarget(dst)) {
      let ingress: any = { toPorts: [{ ports }] };
      const spec = {
        endpointSelector: { matchLabels: dst.endpoint },
        ingress: [ingress],
      };

      if (isCidrTarget(src)) {
        ingress["fromCIDR"] = [src.cidr];
      } else if (isEndpointTarget(src)) {
        ingress["fromEndpoints"] = [{ matchLabels: src.endpoint }];
      } else if (isEntityTarget(src)) {
        ingress["fromEntities"] = [src.entity];
      } else {
        throw new Error(`invalid src target: ${JSON.stringify(src)}`);
      }

      specs.push(spec);
    }
  });

  const name = chart.namespace;
  return new CiliumClusterwideNetworkPolicy(chart, `netpol-${name}`, {
    metadata: { name },
    specs,
  });
};

/**
 * Helper method that exposes a builder allowing for simpler creation of network policy resources.
 *
 * @param chart the chart to attach the k8s resource to
 * @param cb the callback invoked with a builder used to create network policy rules
 * @returns a CiliumClusterwideNetworkPolicy resource
 */
export const createNetworkPolicy = (
  chart: Chart,
  cb: NetworkPolicyCallback
) => {
  const rules: Rule[] = [];
  const builder: NetworkPolicyBuilder = {
    rule: (src, dst, ...portKeys) => {
      const rule = createRule(src, dst, ...portKeys);
      rules.push(rule);
      return rule;
    },
    target: createTarget,
  };
  cb(builder);
  return _createNetworkPolicy(chart, rules);
};

export const specialTargets = createTargets((b) => ({
  kubeApiserver: b.target({
    entity: "kube-apiserver",
    ports: { default: [6443, "tcp"] },
  }),
}));
