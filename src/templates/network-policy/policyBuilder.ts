import { Construct } from "constructs";
import crypto from "crypto";
import {
  CiliumClusterwideNetworkPolicy,
  CiliumClusterwideNetworkPolicySpec,
} from "../../../assets/cilium/cilium.io";
import { Gateway } from "../../cdk8s";

type Port = number;
type PortRange = [number, number];
type Portish = PortRange | Port;

const selectors = {
  nodes: () => ({
    type: "nodes" as const,
    category: "subject" as const,
  }),
  pods: () => ({
    type: "pods" as const,
    category: "subject" as const,
  }),
  cidrs: (...ranges: string[]) => ({
    type: "cidr" as const,
    category: "object" as const,
    ranges,
  }),
  component: (name: string, namespace: string) => ({
    type: "component" as const,
    category: "subject" as const,
    name,
    namespace,
  }),
  controlPlane: () => ({
    type: "control-plane" as const,
    category: "subject" as const,
  }),
  dns: (...names: string[]) => ({
    type: "dns" as const,
    category: "object" as const,
    names,
  }),
  gateway: (name: Gateway) => ({
    type: "gateway" as const,
    category: "subject" as const,
    name,
  }),
  health: () => ({
    type: "health" as const,
    category: "subject" as const,
  }),
  host: (...hostnames: string[]) => ({
    type: "host" as const,
    category: "subject" as const,
    hostnames,
  }),
  kubeApiServer: () => ({
    type: "kube-apiserver" as const,
    category: "subject" as const,
  }),
  dnsWildcard: () => ({
    type: "dns-wildcard" as const,
    category: "specifier" as const,
  }),
  icmpv4: (...icmpTypes: number[]) => ({
    type: "icmpv4" as const,
    category: "specifier" as const,
    icmpTypes,
  }),
  kubeDns: () => ({
    type: "kube-dns" as const,
    category: "subject" as const,
  }),
  pod: (name: string, namespace: string) => ({
    type: "pod" as const,
    category: "subject" as const,
    name,
    namespace,
  }),
  tcp: (...ports: Portish[]) => ({
    type: "tcp" as const,
    category: "specifier" as const,
    ports,
  }),
  udp: (...ports: Portish[]) => ({
    type: "udp" as const,
    category: "specifier" as const,
    ports,
  }),
  description: (description: string) => ({
    type: "description" as const,
    category: "specifier" as const,
    description,
  }),
};

export const {
  nodes,
  pods,
  cidrs,
  component,
  controlPlane,
  dns,
  dnsWildcard,
  gateway,
  health,
  host,
  icmpv4,
  kubeApiServer,
  kubeDns,
  pod,
  tcp,
  udp,
} = selectors;

type Selector = ReturnType<(typeof selectors)[keyof typeof selectors]>;
type Subject = Selector & { category: "subject" };
type Object = Selector & { category: "object" };
type Specifier = Selector & { category: "specifier" };

type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K];
};

const computeHash = (o: unknown) => {
  const json = JSON.stringify(o);
  return crypto.createHash("sha256").update(json).digest("hex");
};

const buildNodeSelector = (
  selector: Selector,
  inRule: boolean = false,
): Record<string, any>[] | undefined => {
  // In rules, skip node selectors for 'nodes' and 'host'
  // since they should use entity selectors instead
  if (
    inRule &&
    (selector.type === "nodes" ||
      selector.type === "host" ||
      selector.type === "kube-apiserver")
  ) {
    return undefined;
  }

  const prefix = inRule ? "node:" : "";

  switch (selector.type) {
    case "host":
    case "nodes":
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
    case "kube-apiserver":
    case "control-plane":
      return [
        {
          matchLabels: {
            [`${prefix}node-role.kubernetes.io/control-plane`]: "",
          },
        },
      ];
    default:
      return undefined;
  }
};

const buildEndpointSelector = (
  selector: Selector,
): Record<string, any>[] | undefined => {
  switch (selector.type) {
    case "pods":
      return [{}];
    case "pod": {
      const ns =
        selector.namespace === "*"
          ? {}
          : {
              "k8s:io.kubernetes.pod.namespace": selector.namespace,
            };
      return [
        {
          matchLabels: {
            ...ns,
            "k8s:app.kubernetes.io/name": selector.name,
          },
        },
      ];
    }
    case "component": {
      const ns =
        selector.namespace === "*"
          ? {}
          : {
              "k8s:io.kubernetes.pod.namespace": selector.namespace,
            };
      return [
        {
          matchLabels: {
            ...ns,
            "k8s:app.kubernetes.io/component": selector.name,
          },
        },
      ];
    }
    case "gateway":
      return [
        {
          matchLabels: {
            "k8s:gateway.envoyproxy.io/owning-gateway-name": selector.name,
            "k8s:io.kubernetes.pod.namespace": "envoy-gateway",
          },
        },
      ];
    case "health":
      return [
        {
          matchLabels: {
            "reserved:health": "",
          },
        },
      ];
    case "kube-dns":
      return [
        {
          matchLabels: {
            "k8s:io.kubernetes.pod.namespace": "kube-system",
            "k8s:k8s-app": "kube-dns",
          },
        },
      ];
    default:
      return undefined;
  }
};

const buildEntitySelector = (selector: Selector): string[] | undefined => {
  switch (selector.type) {
    case "nodes":
      return ["remote-node", "host"];
    case "host":
      return ["host"];
    case "kube-apiserver":
      return ["kube-apiserver"];
    default:
      return undefined;
  }
};

class PolicyBuilder {
  private policy: CiliumClusterwideNetworkPolicy;
  private registry: ServiceRegistry;
  private spec: Mutable<CiliumClusterwideNetworkPolicySpec>;
  readonly subject: Subject;

  constructor(registry: ServiceRegistry, name: string, subject: Subject) {
    const nodeSelectors = buildNodeSelector(subject);
    const endpointSelectors = buildEndpointSelector(subject);

    const spec = {
      nodeSelector: nodeSelectors?.[0],
      endpointSelector: endpointSelectors?.[0],
    };
    this.policy = new CiliumClusterwideNetworkPolicy(registry.construct, name, {
      metadata: {
        name,
      },
      spec,
    });
    this.registry = registry;
    this.spec = spec;
    this.subject = subject;
  }

  private buildRule(
    target: Subject | Object,
    specifiers: Specifier[],
    direction: "ingress" | "egress",
  ) {
    this.spec[direction] ??= [];
    const rules = this.spec[direction];

    const prefixes = { ingress: "from", egress: "to" } as const;
    const prefix = prefixes[direction];
    const ruleKey = (base: string) => prefix + base;

    const rule: Record<string, any> = {
      [ruleKey("Nodes")]: buildNodeSelector(target, true),
      [ruleKey("Endpoints")]: buildEndpointSelector(target),
      [ruleKey("Entities")]: buildEntitySelector(target),
      [ruleKey("Cidr")]: target.type === "cidr" ? target.ranges : undefined,
      [ruleKey("FqdNs")]:
        target.type === "dns"
          ? target.names.map((n) => ({ matchPattern: n }))
          : undefined,
    };

    const ports: Array<Record<string, any>> = [];
    let dnsRules: Record<string, any> | undefined;
    const icmps: Array<Record<string, any>> = [];

    for (const spec of specifiers) {
      switch (spec.type) {
        case "tcp":
        case "udp": {
          const protocols = { tcp: "TCP", udp: "UDP" } as const;
          const protocol = protocols[spec.type];
          for (const portish of spec.ports) {
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
          break;
        }
        case "icmpv4": {
          for (const type of spec.icmpTypes) {
            icmps.push({
              type: { value: type },
              family: "IPv4",
            });
          }
          break;
        }
        case "dns-wildcard": {
          dnsRules = { dns: [{ matchPattern: "*" }] };
          break;
        }
        case "description": {
          this.spec.description = spec.description;
          break;
        }
      }
    }

    if (ports.length > 0) {
      rule.toPorts = [
        {
          ports,
          ...(dnsRules && { rules: dnsRules }),
        },
      ];
    }

    if (icmps.length > 0) {
      rule.icmps = [{ fields: icmps }];
    }

    rules.push(rule);
  }

  _to(object: Subject | Object, ...specifiers: Specifier[]) {
    this.buildRule(object, specifiers, "egress");
    return this;
  }

  to(object: Subject | Object | PolicyBuilder, ...specifiers: Specifier[]) {
    if (object instanceof PolicyBuilder) {
      object._from(this.subject, ...specifiers);
      this._to(object.subject, ...specifiers);
    } else if (object.category === "subject") {
      const builder = this.registry.get(object);
      builder._from(this.subject, ...specifiers);
      this._to(object, ...specifiers);
    } else {
      this._to(object, ...specifiers);
    }
    return this;
  }

  _from(subject: Subject | Object, ...specifiers: Specifier[]) {
    this.buildRule(subject, specifiers, "ingress");
    return this;
  }

  from(subject: Subject | Object | PolicyBuilder, ...specifiers: Specifier[]) {
    if (subject instanceof PolicyBuilder) {
      subject._to(this.subject, ...specifiers);
      this._from(subject.subject, ...specifiers);
    } else if (subject.category === "subject") {
      const builder = this.registry.get(subject);
      builder._to(this.subject, ...specifiers);
      this._from(subject, ...specifiers);
    } else {
      this._from(subject, ...specifiers);
    }
    return this;
  }
}

class ServiceRegistry {
  readonly construct: Construct;
  readonly builders: Record<string, PolicyBuilder>;

  constructor(construct: Construct) {
    this.construct = construct;
    this.builders = {};
  }

  register(name: string, subject: Subject) {
    const hash = computeHash(subject);
    if (this.builders[hash] !== undefined) {
      throw new Error(`policy builder for ${name} already exists`);
    }
    const builder = new PolicyBuilder(this, name, subject);
    this.builders[hash] = builder;
    return builder;
  }

  get(subject: Subject) {
    const hash = computeHash(subject);
    if (this.builders[hash] === undefined) {
      throw new Error(`policy builder for ${name} does not exists`);
    }
    return this.builders[hash];
  }
}

export const services = (construct: Construct) => {
  const registry = new ServiceRegistry(construct);
  return registry.register.bind(registry);
};
