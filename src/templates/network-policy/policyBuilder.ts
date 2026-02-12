import { ApiObject } from "cdk8s";
import { Construct } from "constructs";
import { Gateway } from "../../cdk8s";

type Port = number;
type PortRange = [number, number];
type Portish = PortRange | Port;

const selectors = {
  allNodes: () => ({
    type: "all-nodes" as const,
    categories: ["node"] as const,
  }),
  allPods: () => ({
    type: "all-pods" as const,
    categories: ["endpoint"] as const,
  }),
  cidrs: (...ranges: string[]) => ({
    type: "cidr" as const,
    categories: ["cidr"] as const,
    ranges,
  }),
  component: (name: string, namespace: string) => ({
    type: "component" as const,
    categories: ["endpoint"] as const,
    name,
    namespace,
  }),
  controlPlane: () => ({
    type: "control-plane" as const,
    categories: ["node"] as const,
  }),
  dns: (...names: string[]) => ({
    type: "dns" as const,
    categories: ["fqdns"] as const,
    names,
  }),
  gateway: (name: Gateway) => ({
    type: "gateway" as const,
    categories: ["endpoint"] as const,
    name,
  }),
  health: () => ({
    type: "health" as const,
    categories: ["endpoint"] as const,
  }),
  host: () => ({
    type: "host" as const,
    categories: ["entity", "node"] as const,
  }),
  icmpv4: (...icmpTypes: number[]) => ({
    type: "icmpv4" as const,
    categories: ["icmp"] as const,
    icmpTypes,
  }),
  icmpv6: (...icmpTypes: number[]) => ({
    type: "icmpv6" as const,
    categories: ["icmp"] as const,
    icmpTypes,
  }),
  kubeDns: () => ({
    type: "kube-dns" as const,
    categories: ["endpoint"] as const,
  }),
  pod: (name: string, namespace: string) => ({
    type: "pod" as const,
    categories: ["endpoint"] as const,
    name,
    namespace,
  }),
  tcp: (...ports: Portish[]) => ({
    type: "tcp" as const,
    categories: ["port"] as const,
    ports,
  }),
  udp: (...ports: Portish[]) => ({
    type: "udp" as const,
    categories: ["port"] as const,
    ports,
  }),
};

export const {
  allNodes,
  allPods,
  cidrs,
  component,
  controlPlane,
  dns,
  gateway,
  health,
  host,
  icmpv4,
  icmpv6,
  kubeDns,
  pod,
  tcp,
  udp,
} = selectors;

type SelectorMap = typeof selectors;
type Selector<K extends keyof SelectorMap> = ReturnType<SelectorMap[K]>;
type SelectorCategories<K extends keyof SelectorMap> =
  Selector<K>["categories"][number];
type SelectorWithCategory<C extends string> = {
  [K in keyof SelectorMap]: C extends SelectorCategories<K>
    ? Selector<K>
    : never;
}[keyof SelectorMap];

const isSelectorWithCategory = <C extends string>(
  v: any,
  c: C,
): v is SelectorWithCategory<C> => {
  const categories = v.categories ?? [];
  return categories.indexOf(c) !== -1;
};

type CIDRSelector = SelectorWithCategory<"cidr">;

const isCIDRSelector = (v: any): v is CIDRSelector =>
  isSelectorWithCategory(v, "cidr");

type EntitySelector = SelectorWithCategory<"entity">;

const isEntitySelector = (v: any): v is EntitySelector =>
  isSelectorWithCategory(v, "entity");

type EndpointSelector = SelectorWithCategory<"endpoint">;

const isEndpointSelector = (v: any): v is EndpointSelector =>
  isSelectorWithCategory(v, "endpoint");

type FQDNSSelector = SelectorWithCategory<"fqdns">;

const isFQDNSSelector = (v: any): v is FQDNSSelector =>
  isSelectorWithCategory(v, "fqdns");

type ICMPSelector = SelectorWithCategory<"icmp">;

const isICMPSelector = (v: any): v is ICMPSelector =>
  isSelectorWithCategory(v, "icmp");

type NodeSelector = SelectorWithCategory<"node">;

const isNodeSelector = (v: any): v is NodeSelector =>
  isSelectorWithCategory(v, "node");

type PortSelector = SelectorWithCategory<"port">;

const isPortSelector = (v: any): v is PortSelector =>
  isSelectorWithCategory(v, "port");

type TargetSelector = EndpointSelector | NodeSelector;

type RuleSelector =
  | CIDRSelector
  | EndpointSelector
  | EntitySelector
  | FQDNSSelector
  | NodeSelector;

type ProtocolSelector = PortSelector | ICMPSelector;

class CiliumPolicy {
  private metadata: Record<string, any>;
  private spec: Record<string, any>;
  private policy: ApiObject;

  constructor(construct: Construct, name: string, target: TargetSelector) {
    const onlyOne = <T extends any>(v: T[] | undefined): T => {
      if (!v || v.length !== 1) {
        throw new Error(`invalid selector: ${target}`);
      }
      return v[0];
    };

    const endpointSelector = isEndpointSelector(target)
      ? onlyOne(this.buildEndpointSelectors(target))
      : undefined;

    const nodeSelector = isNodeSelector(target)
      ? onlyOne(this.buildNodeSelectors(target, false))
      : undefined;

    if (!endpointSelector === !nodeSelector) {
      throw new Error(`invalid selector: ${target}`);
    }

    this.policy = new ApiObject(construct, name, {
      apiVersion: "cilium.io/v2",
      kind: "CiliumClusterwideNetworkPolicy",
      metadata: {
        name,
        annotations: {},
      },
      spec: {
        endpointSelector,
        nodeSelector,
      },
    });

    this.metadata = this.policy.metadata as any;
    this.spec = (this.policy as any).props.spec;
  }

  getPortProtocol(selector: PortSelector) {
    switch (selector.type) {
      case "tcp": {
        return "TCP";
      }
      case "udp": {
        return "UDP";
      }
      default: {
        const _: never = selector;
        throw new Error(`unknown port type: ${selector}`);
      }
    }
  }

  buildPortSelectors(selectors: PortSelector[], addDnsRule: boolean) {
    const ports = [];
    for (const selector of selectors) {
      const protocol = this.getPortProtocol(selector);
      for (const portish of selector.ports) {
        if (Array.isArray(portish)) {
          ports.push({
            port: portish[0].toString(),
            endPort: portish[1],
            protocol,
          });
        } else {
          ports.push({
            port: portish.toString(),
            protocol,
          });
        }
      }
    }

    if (ports.length === 0) {
      return undefined;
    }

    let rules: any;
    if (addDnsRule) {
      rules = {
        dns: [{ matchPattern: "*" }],
      };
    }

    return [{ ports, rules }];
  }

  getICMPFamily(selector: ICMPSelector) {
    switch (selector.type) {
      case "icmpv4": {
        return "IPv4";
      }
      case "icmpv6": {
        return "IPv6";
      }
      default: {
        const _: never = selector;
        throw new Error(`unknown icmp type: ${selector}`);
      }
    }
  }

  buildICMPSelectors(selectors: ICMPSelector[]) {
    const fields = [];
    for (const selector of selectors) {
      const family = this.getICMPFamily(selector);
      for (const type of selector.icmpTypes) {
        fields.push({
          type,
          family,
        });
      }
    }

    if (fields.length === 0) {
      return undefined;
    }

    return [{ fields }];
  }

  separateProtocolSelectors(protocolSelectors: ProtocolSelector[]) {
    const portSelectors: PortSelector[] = [];
    const icmpSelectors: ICMPSelector[] = [];
    for (const protocolSelector of protocolSelectors) {
      if (isPortSelector(protocolSelector)) {
        portSelectors.push(protocolSelector);
      } else if (isICMPSelector(protocolSelector)) {
        icmpSelectors.push(protocolSelector);
      }
    }
    return { icmpSelectors, portSelectors };
  }

  buildRules(
    target: RuleSelector,
    protocolSelectors: ProtocolSelector[],
    ruleType: "ingress" | "egress",
  ) {
    const rules =
      ruleType === "ingress"
        ? (this.spec.ingress = this.spec.ingress ?? [])
        : (this.spec.egress = this.spec.egress ?? []);

    const { portSelectors, icmpSelectors } =
      this.separateProtocolSelectors(protocolSelectors);

    const cidr = isCIDRSelector(target)
      ? this.buildCIDRSelectors(target)
      : undefined;
    const endpoints = isEndpointSelector(target)
      ? this.buildEndpointSelectors(target)
      : undefined;
    const entities = isEntitySelector(target)
      ? this.buildEntitySelectors(target)
      : undefined;
    const fqdns = isFQDNSSelector(target)
      ? this.buildFQDNSelectors(target)
      : undefined;
    const nodes = isNodeSelector(target)
      ? this.buildNodeSelectors(target, true)
      : undefined;
    const icmps = this.buildICMPSelectors(icmpSelectors);

    const rule: Record<string, any> = {};
    if (ruleType === "ingress") {
      rule["fromCIDR"] = cidr;
      rule["fromEndpoints"] = endpoints;
      rule["fromEntities"] = entities;
      rule["fromFQDNs"] = fqdns;
      rule["fromNodes"] = nodes;
      rule["icmps"] = icmps;
    } else {
      rule["toCIDR"] = cidr;
      rule["toEndpoints"] = endpoints;
      rule["toEntities"] = entities;
      rule["toFQDNs"] = fqdns;
      rule["toNodes"] = nodes;
      rule["icmps"] = icmps;
    }

    let hasDnsPort = false;
    portSelectors.forEach((s) => {
      for (const p of s.ports) {
        if (Array.isArray(p)) {
          if (p[0] <= 53 && 53 <= p[1]) {
            hasDnsPort = true;
          }
        } else {
          if (p === 53) {
            hasDnsPort = true;
          }
        }
      }
    });
    const addDnsRule = target.type === "kube-dns" && hasDnsPort;
    rule["toPorts"] = this.buildPortSelectors(portSelectors, addDnsRule);
    rules.push(rule);

    return this;
  }

  buildCIDRSelectors(selector: CIDRSelector) {
    if (selector.ranges.length === 0) {
      throw new Error("empty cidr list");
    }
    return selector.ranges;
  }

  buildEndpointSelectors(selector: EndpointSelector) {
    const namespace = (namespace: string) => {
      if (namespace === "*") {
        return {};
      }
      return {
        "k8s:io.kubernetes.pod.namespace": namespace,
      };
    };

    switch (selector.type) {
      case "all-pods": {
        return [{}];
      }
      case "component": {
        return [
          {
            matchLabels: {
              ...namespace(selector.namespace),
              "k8s:app.kubernetes.io/component": selector.name,
            },
          },
        ];
      }
      case "gateway": {
        return [
          {
            matchLabels: {
              "k8s:gateway.envoyproxy.io/owning-gateway-name": selector.name,
              "k8s:io.kubernetes.pod.namespace": "envoy-gateway",
            },
          },
        ];
      }
      case "health": {
        return [
          {
            matchLabels: {
              "reserved:health": "",
            },
          },
        ];
      }
      case "kube-dns": {
        return [
          {
            matchLabels: {
              "k8s:io.kubernetes.pod.namespace": "kube-system",
              "k8s:k8s-app": "kube-dns",
            },
          },
        ];
      }
      case "pod": {
        return [
          {
            matchLabels: {
              ...namespace(selector.namespace),
              "k8s:app.kubernetes.io/name": selector.name,
            },
          },
        ];
      }
      default: {
        const _: never = selector;
        throw new Error(`invalid selector: ${selector}`);
      }
    }
  }

  buildEntitySelectors(selector: EntitySelector) {
    return ["host"];
  }

  buildFQDNSelectors(selector: FQDNSSelector) {
    return selector.names.map((n) => ({
      matchPattern: n,
    }));
  }

  buildNodeSelectors(
    selector: NodeSelector,
    isRule: boolean,
  ): Record<string, any>[] | undefined {
    const prefix = isRule ? "node:" : "";
    switch (selector.type) {
      case "all-nodes": {
        return [
          {
            matchExpressions: [
              {
                key: `${prefix}kubernetes.io/hostname`,
                operator: "Exists",
              },
            ],
          },
        ];
      }
      case "control-plane": {
        return [
          {
            matchLabels: {
              [`${prefix}node-role.kubernetes.io/control-plane`]: "",
            },
          },
        ];
      }
      case "host": {
        if (isRule) {
          return undefined;
        }
        return [
          {
            matchExpressions: [
              {
                key: `${prefix}kubernetes.io/hostname`,
                operator: "Exists",
              },
            ],
          },
        ];
      }
      default: {
        const _: never = selector;
        throw new Error(`invalid selector: ${selector}`);
      }
    }
  }

  allowEgressTo(
    target: RuleSelector,
    ...protocolSelectors: ProtocolSelector[]
  ) {
    this.buildRules(target, protocolSelectors, "egress");
    return this;
  }

  allowIngressFrom(
    target: RuleSelector,
    ...protocolSelectors: ProtocolSelector[]
  ) {
    this.buildRules(target, protocolSelectors, "ingress");
    return this;
  }

  syncWithRouter() {
    this.metadata.annotations[
      "router-policy-sync.homelab-helper.benfiola.com/sync-with-router"
    ] = "";
    return this;
  }
}

class PolicyBuilder {
  constructor(
    private construct: Construct,
    private name: string,
  ) {}

  allowBetween(
    source: TargetSelector,
    target: TargetSelector,
    ...protocolSelectors: ProtocolSelector[]
  ) {
    const sourceName = `${this.name}--egress`;
    new CiliumPolicy(this.construct, sourceName, source).allowEgressTo(
      target,
      ...protocolSelectors,
    );

    const targetName = `${this.name}--ingress`;
    new CiliumPolicy(this.construct, targetName, target).allowIngressFrom(
      source,
      ...protocolSelectors,
    );
  }

  targets(target: TargetSelector) {
    const policy = new CiliumPolicy(this.construct, this.name, target);

    return policy;
  }
}

interface CreatePolicyBuilderCbOpts {}

export const createPolicyBuilder = (construct: Construct) => {
  return (name: string, opts: CreatePolicyBuilderCbOpts = {}) => {
    return new PolicyBuilder(construct, name);
  };
};
