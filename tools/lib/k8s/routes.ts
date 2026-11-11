import { compact } from "../object.ts";

type Obj = Record<string, any>;

// ingress: one gateway per vlan. every route is exposed through a ListenerSet attached
// to the gateway; https routes get a certificate from the 'cloudflare' cluster issuer.
export const gateways = [
  "family",
  "personal",
  "infrastructure",
  "friends",
] as const;
export type Gateway = (typeof gateways)[number];

const annotations = {
  useMikrotik: "homelab.benfiola.com/use-external-dns-mikrotik",
  useCloudflare: "homelab.benfiola.com/use-external-dns-cloudflare",
  hostname: "external-dns.kubernetes.io/hostname",
} as const;

// which external-dns instances publish a gateway's routes
const gatewayAnnotations: Record<Gateway, string[]> = {
  family: [annotations.useMikrotik],
  personal: [annotations.useMikrotik],
  infrastructure: [annotations.useMikrotik],
  friends: [annotations.useMikrotik, annotations.useCloudflare],
};

const publish = (gateway: Gateway) =>
  Object.fromEntries(gatewayAnnotations[gateway].map((a) => [a, ""]));

// something a route can send traffic to: a Service (as created by `Workload.service`) or
// just its kind and name
export type Target =
  { kind: string; name: string } | { kind: string; metadata: { name: string } };

const ref = (to: Target) => ({
  kind: to.kind,
  name: "name" in to ? to.name : to.metadata.name,
});

const protocols = {
  GRPCRoute: "HTTPS",
  HTTPRoute: "HTTPS",
  TCPRoute: "TCP",
  UDPRoute: "UDP",
} as const;

type RouteKind = keyof typeof protocols;

const listenerSet = (opts: {
  gateway: Gateway;
  name: string;
  routeKind: RouteKind;
  port: number;
  hostname?: string;
}): Obj => {
  const { gateway, name, port, hostname, routeKind } = opts;
  const protocol = protocols[routeKind];
  const https = protocol === "HTTPS";

  return compact({
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "ListenerSet",
    metadata: {
      name,
      annotations: https
        ? { "cert-manager.io/cluster-issuer": "cloudflare" }
        : undefined,
    },
    spec: {
      parentRef: {
        group: "gateway.networking.k8s.io",
        kind: "Gateway",
        name: gateway,
        namespace: "gateway",
      },
      listeners: [
        {
          name,
          hostname,
          port,
          protocol,
          ...(https && {
            tls: {
              mode: "Terminate",
              certificateRefs: [{ name: `${name.replaceAll(".", "-")}-tls` }],
            },
          }),
          allowedRoutes: {
            namespaces: { from: "Same" },
            kinds: [{ group: "gateway.networking.k8s.io", kind: routeKind }],
          },
        },
      ],
    },
  });
};

const routeName = (name: string) => name.replaceAll(".", "-");

const route = (kind: RouteKind, metadata: Obj, spec: Obj): Obj => ({
  apiVersion: "gateway.networking.k8s.io/v1",
  kind,
  metadata,
  spec,
});

// the https listener of a hostname, and the route attached to it
const hostRoutes = (
  kind: "HTTPRoute" | "GRPCRoute",
  gateway: Gateway,
  hostname: string,
  rules: Obj[],
): Obj[] => [
  listenerSet({
    gateway,
    name: hostname,
    hostname,
    port: 443,
    routeKind: kind,
  }),
  route(
    kind,
    { name: routeName(hostname), annotations: publish(gateway) },
    {
      hostnames: [hostname],
      parentRefs: [
        { kind: "ListenerSet", name: hostname, sectionName: hostname },
      ],
      rules,
    },
  ),
];

export interface HttpMatch {
  path?: string;
  pathType?: "Exact" | "PathPrefix" | "RegularExpression";
  timeout?: string;
}

// an https route for a hostname; add where it sends traffic with `match`
export class HttpRoute {
  private readonly listener: Obj;
  private readonly route: Obj;

  constructor(gateway: Gateway, hostname: string) {
    [this.listener, this.route] = hostRoutes(
      "HTTPRoute",
      gateway,
      hostname,
      [],
    );
  }

  match(to: Target, port: number, ...matches: HttpMatch[]): this {
    for (const {
      path = "/",
      pathType = "PathPrefix",
      timeout,
    } of matches.length ? matches : [{}]) {
      this.route.spec.rules.push({
        backendRefs: [{ ...ref(to), port }],
        matches: [{ path: { type: pathType, value: path } }],
        ...(timeout && { timeouts: { request: timeout } }),
      });
    }
    return this;
  }

  objects(): Obj[] {
    return [this.listener, this.route];
  }
}

export interface GrpcMatch {
  service?: string;
  method?: string;
  type?: "Exact" | "RegularExpression";
}

// an https route for grpc traffic; `timeout` also adds a BackendTrafficPolicy
export class GrpcRoute {
  private readonly listener: Obj;
  private readonly route: Obj;
  private readonly policy?: Obj;

  constructor(
    gateway: Gateway,
    hostname: string,
    opts: { timeout?: string } = {},
  ) {
    [this.listener, this.route] = hostRoutes(
      "GRPCRoute",
      gateway,
      hostname,
      [],
    );
    if (opts.timeout) {
      this.policy = {
        apiVersion: "gateway.envoyproxy.io/v1alpha1",
        kind: "BackendTrafficPolicy",
        metadata: { name: hostname },
        spec: {
          targetRefs: [
            {
              group: "gateway.networking.k8s.io",
              kind: "GRPCRoute",
              name: routeName(hostname),
            },
          ],
          timeout: {
            http: {
              maxStreamDuration: opts.timeout,
              requestTimeout: opts.timeout,
            },
          },
        },
      };
    }
  }

  match(to: Target, port: number, ...matches: GrpcMatch[]): this {
    for (const { service, method, type } of matches.length ? matches : [{}]) {
      const hasMethodMatch = service !== undefined || method !== undefined;
      this.route.spec.rules.push({
        backendRefs: [{ ...ref(to), port }],
        ...(hasMethodMatch && {
          matches: [{ method: { service, method, type } }],
        }),
      });
    }
    return this;
  }

  objects(): Obj[] {
    const objects = [this.listener, this.route, this.policy].filter(
      (o): o is Obj => o !== undefined,
    );
    return compact(objects);
  }
}

// a plain tcp or udp port on a hostname, sent to a port on a Service
const portRoute = (
  routeKind: "TCPRoute" | "UDPRoute",
  gateway: Gateway,
  hostname: string,
  fromPort: number,
  to: Target,
  toPort: number,
): Obj[] => {
  const name = routeName(`${hostname}-${fromPort}`);
  const listener = `${hostname}-${routeKind === "TCPRoute" ? "tcp" : "udp"}-${fromPort}`;
  return [
    listenerSet({ gateway, name: listener, port: fromPort, routeKind }),
    route(
      routeKind,
      {
        name,
        annotations: { [annotations.hostname]: hostname, ...publish(gateway) },
      },
      {
        parentRefs: [
          {
            kind: "ListenerSet",
            name: listener,
            sectionName: listener,
            port: fromPort,
          },
        ],
        rules: [{ backendRefs: [{ ...ref(to), port: toPort }] }],
      },
    ),
  ];
};

export const tcpRoute = (
  gateway: Gateway,
  hostname: string,
  fromPort: number,
  to: Target,
  toPort: number,
) => portRoute("TCPRoute", gateway, hostname, fromPort, to, toPort);

export const udpRoute = (
  gateway: Gateway,
  hostname: string,
  fromPort: number,
  to: Target,
  toPort: number,
) => portRoute("UDPRoute", gateway, hostname, fromPort, to, toPort);
