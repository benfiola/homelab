import { createInterface } from "readline/promises";
import * as kubernetes from "./kubernetes";

const includedFlowVerdicts = ["FORWARDED", "AUDIT", "DROPPED"];

const shouldFilterFlow = (data: any) => {
  if (data.is_reply) {
    // flow should already be captured via request - ignore reply.
    return true;
  }

  if (data.trace_observation_point) {
    // ignore trace flows
    return true;
  }

  if (includedFlowVerdicts.indexOf(data.verdict) === -1) {
    // ignore flow verdicts that aren't accepted/denied
    return true;
  }

  const flags = data.l4?.TCP?.flags;
  if (flags && !flags.SYN && !flags.PSH) {
    // ignore tcp traffic that isn't connection init or data push
    return true;
  }

  const dropReason = data.drop_reason;
  if ([139, 151].indexOf(dropReason) !== -1) {
    // ignore 'STALE_OR_UNROUTABLE_IP' dropped traffic
    // ignore 'UNSUPPORTED_L3_PROTOCOL' dropped traffic
    return true;
  }

  const ingressAllowedBy = data.ingress_allowed_by ?? [];
  for (const item of ingressAllowedBy) {
    const labels = getLabelMap(item.labels);
    for (const [key, value] of Object.entries(labels)) {
      if (
        key === "reserved:io.cilium.policy.derived-from" &&
        value === "allow-localhost-ingress"
      ) {
        // ignore traffic that's forwarded by default
        return true;
      }
    }
  }

  return false;
};

interface HealthFlowSubject {
  type: "health";
}

interface HostFlowSubject {
  type: "host";
}

interface NodeFlowSubject {
  name: string;
  type: "node";
}

interface PodFlowSubject {
  component?: string;
  gateway?: string;
  k8sApp?: string;
  pod?: string;

  namespace: string;
  type: "pod";
}

interface UnknownFlowSubject {
  type: "unknown";
}

interface WorldFlowSubject {
  value: string;
  type: "world";
}

export type FlowSubject =
  | HealthFlowSubject
  | HostFlowSubject
  | NodeFlowSubject
  | PodFlowSubject
  | UnknownFlowSubject
  | WorldFlowSubject;

const getLabelMap = (labels: string[]) => {
  const labelMap: Record<string, string> = {};
  for (const label of labels) {
    const parts = label.split("=");
    if (parts.length === 1) {
      labelMap[parts[0]] = "";
    } else {
      labelMap[parts[0]] = parts.slice(1).join("=");
    }
  }
  return labelMap;
};

const getFlowSubject = (
  data: any,
  nodeIps: Record<string, string>,
  source: boolean,
): FlowSubject => {
  const labels = source ? data.source.labels : data.destination.labels;
  const labelMap = getLabelMap(labels);

  const namespace = labelMap["k8s:io.kubernetes.pod.namespace"];
  if (namespace) {
    return {
      type: "pod",
      namespace,

      component: labelMap["k8s:app.kubernetes.io/component"],
      k8sApp: labelMap["k8s:k8s-app"],
      gateway: labelMap["k8s:gateway.envoyproxy.io/owning-gateway-name"],
      pod: labelMap["k8s:app.kubernetes.io/name"],
    };
  } else if (labelMap["reserved:health"] === "") {
    return { type: "health" };
  } else if (labelMap["reserved:host"] === "") {
    return { type: "host" };
  } else if (labelMap["reserved:remote-node"] === "") {
    const ip = source ? data.IP?.source : data.IP?.destination;
    const node = nodeIps[ip];
    if (!node) {
      throw new Error(`unrecognized node ip: ${ip}`);
    }
    return { type: "node", name: node };
  } else if (labelMap["reserved:world"] === "") {
    const ip = source ? data.IP?.source : data.IP?.destination;
    return { type: "world", value: ip };
  } else if (labelMap["reserved:unknown"] === "") {
    return { type: "unknown" };
  }

  throw new Error(`unrecognized flow: ${JSON.stringify(data, null, 2)}`);
};

export type FlowVerdict = "allowed" | "denied";

const getFlowVerdict = (data: any): FlowVerdict => {
  const verdict = data.verdict;
  if (["FORWARDED"].indexOf(verdict) !== -1) {
    return "allowed";
  } else if (["AUDIT", "DROPPED"].indexOf(verdict) !== -1) {
    return "denied";
  }

  throw new Error(`unexpected verdict: ${verdict}`);
};

export type FlowDirection = "ingress" | "egress";

const getFlowDirection = (data: any): FlowDirection => {
  const direction = data.traffic_direction;
  if (direction === "EGRESS") {
    return "egress";
  } else if (direction === "INGRESS") {
    return "ingress";
  }

  throw new Error(`unexpected direction: ${direction}`);
};

interface TCPFlowProtocol {
  type: "tcp";
  port: number;
}

interface UDPFlowProtocol {
  type: "udp";
  port: number;
}

interface ICMPV4FlowProtocol {
  type: "icmpv4";
  icmpType: number;
}

interface ICMPV6FlowProtocol {
  type: "icmpv6";
  icmpType: number;
}

export type FlowProtocol =
  | ICMPV4FlowProtocol
  | ICMPV6FlowProtocol
  | TCPFlowProtocol
  | UDPFlowProtocol;

const getFlowProtocol = (data: any): FlowProtocol => {
  const icmpv4 = data.l4?.ICMPv4;
  const icmpv6 = data.l4?.ICMPv6;
  const tcp = data.l4?.TCP;
  const udp = data.l4?.UDP;

  if (icmpv4) {
    const icmpType = icmpv4.type;
    return { type: "icmpv4", icmpType };
  } else if (icmpv6) {
    const icmpType = icmpv6.type;
    return { type: "icmpv6", icmpType };
  } else if (tcp) {
    const port = tcp.destination_port;
    return { type: "tcp", port };
  } else if (udp) {
    const port = udp.destination_port;
    return { type: "udp", port };
  }

  const protocols = Object.keys(data.l4 ?? {});
  const protocol = protocols.length > 0 ? protocols[0] : "unknwon";
  throw new Error(`unexpected protocol: ${protocol}`);
};

const getFlowPolicy = (data: any) => {
  if (data.ingress_allowed_by && data.ingress_allowed_by.length > 0) {
    return data.ingress_allowed_by[0].name;
  }
  if (data.egress_allowed_by && data.egress_allowed_by.length > 0) {
    return data.egress_allowed_by[0].name;
  }
  return undefined;
};

export interface Flow {
  raw: Record<string, any>;
  source: FlowSubject;
  destination: FlowSubject;
  verdict: FlowVerdict;
  direction: FlowDirection;
  port: FlowProtocol;
  policy?: string;
}

const createFlow = (data: any, nodeIps: Record<string, string>): Flow => {
  const source = getFlowSubject(data, nodeIps, true);
  const destination = getFlowSubject(data, nodeIps, false);
  const verdict = getFlowVerdict(data);
  const direction = getFlowDirection(data);
  const port = getFlowProtocol(data);
  const policy = getFlowPolicy(data);

  return {
    source,
    destination,
    verdict,
    direction,
    port,
    raw: data,
    policy,
  };
};

const getNodeIps = async () => {
  const data = await kubernetes.get(null, "ciliumnodes");
  const nodeIps: Record<string, string> = {};
  for (const item of data.items) {
    const name = item.metadata.name;
    for (const address of item.spec.addresses) {
      nodeIps[address.ip] = name;
    }
  }
  return nodeIps;
};

interface AnalyzeOpts {
  onFlow?: (flow: Flow) => void;
}

export const analyze = async (
  stream: NodeJS.ReadableStream,
  opts: AnalyzeOpts = {},
) => {
  const nodeIps = await getNodeIps();

  const lineReader = createInterface({ input: stream });

  for await (const line of lineReader) {
    if (line === "") {
      continue;
    }

    let data: Record<string, any>;
    try {
      data = JSON.parse(line).flow;
    } catch (e) {
      throw new Error(`non-JSON line detected: ${line}`);
    }

    if (!data) {
      continue;
    }

    if (shouldFilterFlow(data)) {
      continue;
    }

    const flow = createFlow(data, nodeIps);
    opts.onFlow?.(flow);
  }
};
