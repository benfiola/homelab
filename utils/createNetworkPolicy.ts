import { Chart } from "cdk8s";
import {
  CiliumClusterwideNetworkPolicy,
  CiliumClusterwideNetworkPolicySpecs,
  CiliumClusterwideNetworkPolicySpecsEgress,
  CiliumClusterwideNetworkPolicySpecsIngress,
} from "../resources/cilium/cilium.io";

type Protocol = "tcp" | "udp" | "any";
type Port = [number, Protocol];

interface WithPorts {
  ports: Port[];
}

interface Cidr {
  cidr: string;
}

/**
 * Typeguard ensuring an object is a Cidr
 * @param v the object to check
 * @returns true if v is a Cidr
 */
const isCidr = (v: any): v is Cidr => {
  return v["cidr"] !== undefined;
};

interface Dns {
  dns: string;
}

/**
 * Typeguard ensuring an object is a Dns
 * @param v the object to check
 * @returns true if v is a Dns
 */
const isDns = (v: any): v is Dns => {
  return v["dns"] !== undefined;
};

interface Endpoint {
  endpoint: Record<string, string>;
}

/**
 * Typeguard ensuring an object is a Endpoint
 * @param v the object to check
 * @returns true if v is a Endpoint
 */
const isEndpoint = (v: any): v is Endpoint => {
  return v["endpoint"] !== undefined;
};

// See: https://docs.cilium.io/en/stable/security/policy/language/#entities-based
type EntityValue =
  | "cluster"
  | "host"
  | "ingress"
  | "kube-apiserver"
  | "remote-node";

interface Entity {
  entity: EntityValue;
}

/**
 * Typeguard ensuring an object is a Entity
 * @param v the object to check
 * @returns true if v is a Entity
 */
const isEntity = (v: any): v is Entity => {
  return v["entity"] !== undefined;
};

interface ExternalPod {
  externalPod: [string, string];
}

/**
 * Typeguard ensuring an object is a ExternalPod
 * @param v the object to check
 * @returns true if v is a ExternalPod
 */
const isExternalPod = (v: any): v is ExternalPod => {
  return v["externalPod"] !== undefined;
};

interface HomeNetwork {
  homeNetwork: null;
}

/**
 * Typeguard ensuring an object is a HomeNetwork
 * @param v the object to check
 * @returns true if v is a HomeNetwork
 */
const isHomeNetwork = (v: any): v is HomeNetwork => {
  return v["homeNetwork"] !== undefined;
};

interface KubeDns {
  kubeDns: null;
}

/**
 * Typeguard ensuring an object is a KubeDns
 * @param v the object to check
 * @returns true if v is a KubeDns
 */
const isKubeDns = (v: any): v is KubeDns => {
  return v["kubeDns"] !== undefined;
};

// Longhorn is a special case whose deployments aren't configurable and bfiola.dev/pod-name labels cannot be attached to its workloads.
interface Longhorn {
  longhorn: { app?: string; component?: string };
}

/**
 * Typeguard ensuring an object is a Longhorn
 * @param v the object to check
 * @returns true if v is a Longhorn
 */
const isLonghorn = (v: any): v is Longhorn => {
  return v["longhorn"] !== undefined;
};

interface Pod {
  pod: string;
}

/**
 * Typeguard ensuring an object is a Pod
 * @param v the object to check
 * @returns true if v is a Pod
 */
const isPod = (v: any): v is Pod => {
  return v["pod"] !== undefined;
};

/**
 * Processes a Resource - translating EndpointLike resources into actual Endpoint resources
 *
 * @param r the resource to convert
 * @param namespace the current namespace
 * @returns the processed resource
 */
const processResource = <T extends Resource | (Resource & WithPorts)>(
  r: T,
  namespace: string
): T => {
  let v: any = { ...r };
  if (isExternalPod(r)) {
    v["endpoint"] = {
      "io.kubernetes.pod.namespace": r.externalPod[0],
      "bfiola.dev/pod-name": r.externalPod[1],
    };
    delete v["externalPod"];
  } else if (isKubeDns(r)) {
    v["endpoint"] = {
      "io.kubernetes.pod.namespace": "kube-system",
      "k8s-app": "kube-dns",
    };
    delete v["kubeDns"];
  } else if (isHomeNetwork(r)) {
    v["cidr"] = "192.168.0.0/16";
    delete v["homeNetwork"];
  } else if (isLonghorn(r)) {
    v["endpoint"] = {
      "io.kubernetes.pod.namespace": namespace,
    };
    if (r.longhorn.app !== undefined) {
      v["endpoint"]["app"] = r.longhorn.app;
    }
    if (r.longhorn.component !== undefined) {
      v["endpoint"]["longhorn.io/component"] = r.longhorn.component;
    }
    delete v["longhorn"];
  } else if (isPod(r)) {
    v["endpoint"] = {
      "io.kubernetes.pod.namespace": namespace,
      "bfiola.dev/pod-name": r.pod,
    };
    delete v["pod"];
  }
  return v;
};

type CidrLike = HomeNetwork;
type EndpointLike = ExternalPod | KubeDns | Longhorn | Pod;
type Resource = Cidr | CidrLike | Dns | Endpoint | EndpointLike | Entity;

/**
 * Typeguard ensuring an object is not only an Endpoint *but* that its namespace points to the current namespace.
 * @param v the object to check
 * @param namespace the current namespace
 * @returns true if v is an Endpoint with a namespace label pointing to the current namespace
 */
const isLocalEndpoint = (v: any, namespace: string): v is Endpoint => {
  return (
    isEndpoint(v) && v.endpoint["io.kubernetes.pod.namespace"] == namespace
  );
};

interface CreateNetworkPolicyRule {
  from: Resource;
  to: Resource & WithPorts;
}

/**
 * Creates a CiliumClusterwideNetworkPolicy with the provided rules.
 *
 * Intended to be *the* network policy for the entire namespace and is named after the namespace itself.
 * Will create rules when rules[].to points to an endpoint in the namespace defined in the chart
 * Will create rules when rules[].from points to an endpoint in the namespace defined in the chart
 *
 * @param chart the chart to attach to (NOTE: uses the chart.namespace field)
 * @param rules the rules to insert into the network policy
 * @returns the constructed network policy
 */
export const createNetworkPolicy = (
  chart: Chart,
  rules: CreateNetworkPolicyRule[]
): CiliumClusterwideNetworkPolicy => {
  if (chart.namespace === undefined) {
    throw new Error("chart namespace undefined");
  }

  let specs: CiliumClusterwideNetworkPolicySpecs[] = [];

  for (const rule of rules) {
    const ruleTo = processResource(rule.to, chart.namespace);
    const ruleFrom = processResource(rule.from, chart.namespace);

    let ports: { port: string; protocol: any }[] = [];
    for (const port of ruleTo.ports) {
      ports.push({
        port: `${port[0]}`,
        protocol: port[1].toUpperCase() as any,
      });
    }

    if (isLocalEndpoint(ruleTo, chart.namespace)) {
      let ingress: CiliumClusterwideNetworkPolicySpecsIngress[] = [];
      if (isCidr(ruleFrom)) {
        ingress.push({
          fromCidr: [ruleFrom.cidr],
        });
      } else if (isEndpoint(ruleFrom)) {
        ingress.push({
          fromEndpoints: [{ matchLabels: ruleFrom.endpoint }],
        });
      } else if (isEntity(ruleFrom)) {
        ingress.push({
          fromEntities: [ruleFrom.entity as any],
        });
      } else {
        throw new Error(`unimplemented: ${JSON.stringify(rule.from)}`);
      }

      (ingress[0].toPorts as any) = [{ ports }];

      specs.push({
        endpointSelector: {
          matchLabels: ruleTo.endpoint,
        },
        ingress,
      });
    }

    if (isLocalEndpoint(ruleFrom, chart.namespace)) {
      let egress: CiliumClusterwideNetworkPolicySpecsEgress[] = [];
      if (isCidr(ruleTo)) {
        egress.push({
          toCidr: [ruleTo.cidr],
        });
      } else if (isDns(ruleTo)) {
        let rule;
        if (ruleTo.dns.indexOf("*") === -1) {
          rule = { matchName: ruleTo.dns };
        } else {
          rule = { matchPattern: ruleTo.dns };
        }
        egress.push({
          toFqdNs: [rule],
        });
      } else if (isEndpoint(ruleTo)) {
        egress.push({
          toEndpoints: [{ matchLabels: ruleTo.endpoint }],
        });
      } else if (isEntity(ruleTo)) {
        egress.push({
          toEntities: [ruleTo.entity as any],
        });
      } else {
        throw new Error(`unimplemented: ${JSON.stringify(ruleTo)}`);
      }
      (egress[0].toPorts as any) = [{ ports }];

      specs.push({
        endpointSelector: {
          matchLabels: ruleFrom.endpoint,
        },
        egress,
      });
    }
  }

  return new CiliumClusterwideNetworkPolicy(chart, chart.namespace, {
    metadata: {
      name: chart.namespace,
    },
    specs: specs,
  });
};
