import { canonical } from "../object.ts";
import type { Gateway } from "./routes.ts";

type Obj = Record<string, any>;

type Port = number;
type PortRange = [number, number];
type Portish = PortRange | Port;

// what a policy is about, and what its rules talk to. a `subject` has a policy of its own; an
// `object` (cidrs, dns names) is only ever the other end of a rule; a `specifier` narrows a rule.
const selectors = {
  app: (name: string, namespace: string) => ({
    type: "app" as const,
    category: "subject" as const,
    name,
    namespace,
  }),
  assetsServer: (namespace: string) => ({
    type: "assetsServer" as const,
    category: "subject" as const,
    namespace,
  }),
  nodes: () => ({ type: "nodes" as const, category: "subject" as const }),
  pods: () => ({ type: "pods" as const, category: "subject" as const }),
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
  health: () => ({ type: "health" as const, category: "subject" as const }),
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
  kubeDns: () => ({ type: "kube-dns" as const, category: "subject" as const }),
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
};

export const {
  app: appLabel,
  assetsServer,
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
export type Subject = Selector & { category: "subject" };
export type External = Selector & { category: "object" };
export type Specifier = Selector & { category: "specifier" };

// the labels cilium sees on a pod, in the namespace the selector names ('*' is any namespace)
const podLabels = (namespace: string, labels: Record<string, string>) => ({
  matchLabels: {
    ...(namespace === "*"
      ? {}
      : { "k8s:io.kubernetes.pod.namespace": namespace }),
    ...labels,
  },
});

// the selector of a host policy (a policy about nodes, not pods)
const nodeSelector = (selector: Selector): Obj | undefined => {
  switch (selector.type) {
    case "host":
    case "nodes":
      return {
        matchExpressions: [
          { key: "kubernetes.io/hostname", operator: "Exists" },
        ],
      };
    case "kube-apiserver":
    case "control-plane":
      return { matchLabels: { "node-role.kubernetes.io/control-plane": "" } };
    default:
      return undefined;
  }
};

// the same, as the other end of a rule: nodes, host and the apiserver are entities there instead
const ruleNodeSelector = (selector: Selector): Obj[] | undefined => {
  if (
    selector.type === "nodes" ||
    selector.type === "host" ||
    selector.type === "kube-apiserver"
  ) {
    return undefined;
  }
  if (selector.type === "control-plane") {
    return [
      { matchLabels: { "node:node-role.kubernetes.io/control-plane": "" } },
    ];
  }
  return undefined;
};

const endpointSelector = (selector: Selector): Obj | undefined => {
  switch (selector.type) {
    case "pods":
      return {};
    case "app":
      return podLabels(selector.namespace, { "k8s:app": selector.name });
    case "assetsServer":
      return podLabels(selector.namespace, {
        "k8s:app.kubernetes.io/name": "assets-server",
      });
    case "pod":
      return podLabels(selector.namespace, {
        "k8s:app.kubernetes.io/name": selector.name,
      });
    case "component":
      return podLabels(selector.namespace, {
        "k8s:app.kubernetes.io/component": selector.name,
      });
    case "gateway":
      return {
        matchLabels: {
          "k8s:gateway.envoyproxy.io/owning-gateway-name": selector.name,
          "k8s:io.kubernetes.pod.namespace": "envoy-gateway",
        },
      };
    case "health":
      return { matchLabels: { "reserved:health": "" } };
    case "kube-dns":
      return {
        matchLabels: {
          "k8s:io.kubernetes.pod.namespace": "kube-system",
          "k8s:k8s-app": "kube-dns",
        },
      };
    default:
      return undefined;
  }
};

const entitySelector = (selector: Selector): string[] | undefined => {
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

// what a rule of a policy is about: the labels of a subject, or an external peer
type Peer = Subject | External;

class PolicyBuilder {
  readonly subject: Subject;
  private readonly name: string;
  private readonly spec: Obj;
  private used = false;

  constructor(name: string, subject: Subject) {
    this.name = name;
    this.subject = subject;
    const node = nodeSelector(subject);
    const endpoint = endpointSelector(subject);
    this.spec = {
      ...(node && { nodeSelector: node }),
      ...(endpoint && { endpointSelector: endpoint }),
    };
  }

  wasUsed() {
    return this.used;
  }

  // the policy. cilium reads its rules as a set, so they are put in an order that doesn't depend on
  // the order they were declared in: the output stays the same however the apps are arranged.
  object(): Obj {
    const sorted = (rules: Obj[]) =>
      [...rules].sort((a, b) => canonical(a).localeCompare(canonical(b)));
    const { ingress, egress, ...rest } = this.spec;
    return {
      apiVersion: "cilium.io/v2",
      kind: "CiliumClusterwideNetworkPolicy",
      metadata: { name: this.name },
      spec: {
        ...rest,
        ...(ingress && { ingress: sorted(ingress) }),
        ...(egress && { egress: sorted(egress) }),
      },
    };
  }

  allow(peer: Peer, specifiers: Specifier[], direction: "ingress" | "egress") {
    this.used = true;
    const rules = (this.spec[direction] ??= []);
    const prefix = direction === "ingress" ? "from" : "to";

    const nodes = ruleNodeSelector(peer);
    const endpoint = endpointSelector(peer);
    const entities = entitySelector(peer);
    const rule: Obj = {
      ...(nodes && { [`${prefix}Nodes`]: nodes }),
      ...(endpoint && { [`${prefix}Endpoints`]: [endpoint] }),
      ...(entities && { [`${prefix}Entities`]: entities }),
      ...(peer.type === "cidr" && { [`${prefix}CIDR`]: peer.ranges }),
      ...(peer.type === "dns" && {
        [`${prefix}FQDNs`]: peer.names.map((n) => ({ matchPattern: n })),
      }),
    };

    const ports: Obj[] = [];
    let dnsRules: Obj | undefined;
    const icmps: Obj[] = [];
    for (const specifier of specifiers) {
      switch (specifier.type) {
        case "tcp":
        case "udp": {
          const protocol = specifier.type === "tcp" ? "TCP" : "UDP";
          for (const portish of specifier.ports) {
            ports.push(
              Array.isArray(portish)
                ? { port: portish[0].toString(), endPort: portish[1], protocol }
                : { port: portish.toString(), protocol },
            );
          }
          break;
        }
        case "icmpv4":
          for (const type of specifier.icmpTypes) {
            icmps.push({ type, family: "IPv4" });
          }
          break;
        case "dns-wildcard":
          if (direction === "egress") {
            dnsRules = { dns: [{ matchPattern: "*" }] };
          }
          break;
      }
    }
    if (ports.length > 0) {
      rule.toPorts = [{ ports, ...(dnsRules && { rules: dnsRules }) }];
    }
    if (icmps.length > 0) {
      rule.icmps = [{ fields: icmps }];
    }
    rules.push(rule);
  }
}

// something that can be allowed to reach, or be reached by, another subject or an external peer
export class SubjectRef {
  readonly name: string;
  private readonly registry: PolicyRegistry;
  private readonly owner: string;

  constructor(registry: PolicyRegistry, name: string, owner: string) {
    this.registry = registry;
    this.name = name;
    this.owner = owner;
  }

  // allow this subject to reach `target`. when that is a subject too, it gets the matching ingress
  // rule: a connection is described once and allowed at both ends.
  to(target: SubjectRef | External, ...specifiers: Specifier[]): this {
    this.registry.connect(this, target, specifiers, this.owner);
    return this;
  }

  from(source: SubjectRef | External, ...specifiers: Specifier[]): this {
    this.registry.connect(source, this, specifiers, this.owner);
    return this;
  }
}

// what an app's `network` is given: it declares the subjects the app runs, and says what may
// reach what. an edge is declared once, by one app: the one that starts the connection, or, when
// that is the node, a gateway or an address range (it isn't an app), the one that receives it.
export class Network {
  readonly app: string;
  private readonly registry: PolicyRegistry;

  constructor(registry: PolicyRegistry, app: string) {
    this.app = app;
    this.registry = registry;
  }

  // a subject of this app, with a policy of its own named `name`
  subject(name: string, selector: Subject): SubjectRef {
    return this.registry.declare(name, selector, this.app);
  }

  // a subject any app declares; references are resolved once every app has declared
  ref(name: string): SubjectRef {
    return new SubjectRef(this.registry, name, this.app);
  }

  // the cluster's infrastructure (declared by the network-policy app)
  get controlPlane() {
    return this.ref("control-plane");
  }
  get health() {
    return this.ref("health");
  }
  get host() {
    return this.ref("host");
  }
  get kubeApiServer() {
    return this.ref("kube-apiserver");
  }
  get kubeDns() {
    return this.ref("kube-dns");
  }
  get nodes() {
    return this.ref("nodes");
  }
  get pods() {
    return this.ref("pods");
  }
}

// the type of an app's exported `network`
export type NetworkFunction = (n: Network) => void;

interface Edge {
  source: SubjectRef | External;
  target: SubjectRef | External;
  specifiers: Specifier[];
  owner: string;
}

// the policies of a cluster: every app's subjects and edges
export class PolicyRegistry {
  private readonly subjects = new Map<
    string,
    { selector: Subject; owner: string }
  >();
  private readonly edges: Edge[] = [];

  network(app: string): Network {
    return new Network(this, app);
  }

  declare(name: string, selector: Subject, owner: string): SubjectRef {
    const existing = this.subjects.get(name);
    if (existing) {
      throw new Error(
        `subject '${name}' is declared by ${existing.owner} and by ${owner}`,
      );
    }
    this.subjects.set(name, { selector, owner });
    return new SubjectRef(this, name, owner);
  }

  connect(
    source: SubjectRef | External,
    target: SubjectRef | External,
    specifiers: Specifier[],
    owner: string,
  ) {
    this.edges.push({ source, target, specifiers, owner });
  }

  // the policies, once every subject and edge is known. a subject nothing was allowed to or from has none.
  objects(): Obj[] {
    const builders = new Map<string, PolicyBuilder>();
    const seen = new Map<string, string>();
    for (const [name, { selector, owner }] of this.subjects) {
      const key = canonical(selector);
      if (seen.has(key)) {
        throw new Error(
          `subjects '${seen.get(key)}' and '${name}' (${owner}) select the same pods`,
        );
      }
      seen.set(key, name);
      builders.set(name, new PolicyBuilder(name, selector));
    }

    const resolve = (
      peer: SubjectRef | External,
      owner: string,
    ): PolicyBuilder | External => {
      if (!(peer instanceof SubjectRef)) {
        return peer;
      }
      const builder = builders.get(peer.name);
      if (!builder) {
        const stem = peer.name.split("-")[0];
        const similar = [...builders.keys()]
          .filter((n) => n.includes(stem))
          .slice(0, 8);
        throw new Error(
          `${owner}: no subject '${peer.name}'${similar.length > 0 ? ` (similar: ${similar.join(", ")})` : ""}`,
        );
      }
      return builder;
    };

    const declared = new Map<string, string>();
    for (const edge of this.edges) {
      const source = resolve(edge.source, edge.owner);
      const target = resolve(edge.target, edge.owner);

      const key = canonical({
        source: source instanceof PolicyBuilder ? source.subject : source,
        target: target instanceof PolicyBuilder ? target.subject : target,
        specifiers: edge.specifiers,
      });
      const previous = declared.get(key);
      if (previous !== undefined) {
        const describe = (peer: PolicyBuilder | External) =>
          peer instanceof PolicyBuilder ? peer.subject.type : peer.type;
        throw new Error(
          `the edge ${describe(source)} -> ${describe(target)} (${edge.specifiers.map((s) => s.type).join(", ")}) is declared by ${previous} and by ${edge.owner}`,
        );
      }
      declared.set(key, edge.owner);

      // the target's ingress rule, then the source's egress rule
      if (target instanceof PolicyBuilder) {
        target.allow(
          source instanceof PolicyBuilder ? source.subject : source,
          edge.specifiers,
          "ingress",
        );
      }
      if (source instanceof PolicyBuilder) {
        source.allow(
          target instanceof PolicyBuilder ? target.subject : target,
          edge.specifiers,
          "egress",
        );
      }
    }

    return [...builders.values()]
      .filter((b) => b.wasUsed())
      .map((b) => b.object())
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }
}
