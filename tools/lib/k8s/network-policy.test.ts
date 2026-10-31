import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cidrs,
  component,
  dns,
  dnsWildcard,
  gateway,
  host,
  icmpv4,
  kubeApiServer,
  nodes,
  pod,
  PolicyRegistry,
  tcp,
  udp,
} from "./network-policy.ts";

// a cluster with the infrastructure and one app per call of `app`
const cluster = (
  ...apps: [string, (n: ReturnType<PolicyRegistry["network"]>) => void][]
) => {
  const registry = new PolicyRegistry();
  const infra = registry.network("infra");
  infra.subject("host", host());
  infra.subject("nodes", nodes());
  infra.subject("kube-apiserver", kubeApiServer());
  for (const [name, declare] of apps) {
    declare(registry.network(name));
  }
  return registry;
};

const policies = (registry: PolicyRegistry) =>
  Object.fromEntries(registry.objects().map((p) => [p.metadata.name, p]));

const web = (n: ReturnType<PolicyRegistry["network"]>) =>
  n.subject("web", pod("web", "web"));
const db = (n: ReturnType<PolicyRegistry["network"]>) =>
  n.subject("db", pod("db", "db"));

describe("a connection between subjects", () => {
  test("is allowed at both ends: egress on the source, ingress on the target", () => {
    const registry = cluster(
      ["web", (n) => web(n).to(n.ref("db"), tcp(5432))],
      ["db", (n) => db(n)],
    );
    const { web: w, db: d } = policies(registry);
    assert.deepEqual(w.spec.egress, [
      {
        toEndpoints: [
          {
            matchLabels: {
              "k8s:io.kubernetes.pod.namespace": "db",
              "k8s:app.kubernetes.io/name": "db",
            },
          },
        ],
        toPorts: [{ ports: [{ port: "5432", protocol: "TCP" }] }],
      },
    ]);
    assert.deepEqual(d.spec.ingress, [
      {
        fromEndpoints: [
          {
            matchLabels: {
              "k8s:io.kubernetes.pod.namespace": "web",
              "k8s:app.kubernetes.io/name": "web",
            },
          },
        ],
        toPorts: [{ ports: [{ port: "5432", protocol: "TCP" }] }],
      },
    ]);
  });

  test("reads the same when written from the other end", () => {
    const to = cluster(
      ["web", (n) => web(n).to(n.ref("db"), tcp(5432))],
      ["db", (n) => db(n)],
    );
    const from = cluster(
      ["web", (n) => web(n)],
      ["db", (n) => db(n).from(n.ref("web"), tcp(5432))],
    );
    assert.deepEqual(to.objects(), from.objects());
  });

  test("can refer to a subject an app declares later, or never", () => {
    const registry = cluster(
      ["a", (n) => n.ref("z").to(n.subject("a", pod("a", "a")), tcp(1))],
      ["z", (n) => n.subject("z", pod("z", "z"))],
    );
    assert.deepEqual(Object.keys(policies(registry)), ["a", "z"]);
  });

  test("a reference to a subject nobody declares is an error that names the app and similar subjects", () => {
    const registry = cluster(
      ["web", (n) => web(n).to(n.ref("web-cache"), tcp(1))],
      ["web2", (n) => n.subject("web-assets", pod("a", "a"))],
    );
    assert.throws(
      () => registry.objects(),
      /web: no subject 'web-cache' \(similar: web, web-assets\)/,
    );
  });
});

describe("a connection to something that isn't a subject", () => {
  test("gives only the subject a rule", () => {
    const registry = cluster([
      "web",
      (n) =>
        web(n)
          .to(cidrs("10.0.0.0/8"), tcp(443))
          .to(dns("example.com"), tcp(443)),
    ]);
    const { web: w } = policies(registry);
    assert.deepEqual(
      w.spec.egress,
      [
        {
          toCIDR: ["10.0.0.0/8"],
          toPorts: [{ ports: [{ port: "443", protocol: "TCP" }] }],
        },
        {
          toFQDNs: [{ matchPattern: "example.com" }],
          toPorts: [{ ports: [{ port: "443", protocol: "TCP" }] }],
        },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });

  test("something can come from an address range, too", () => {
    const registry = cluster([
      "web",
      (n) => web(n).from(cidrs("192.168.1.0/24"), tcp(80)),
    ]);
    assert.deepEqual(policies(registry).web.spec.ingress, [
      {
        fromCIDR: ["192.168.1.0/24"],
        toPorts: [{ ports: [{ port: "80", protocol: "TCP" }] }],
      },
    ]);
  });
});

describe("the rules", () => {
  test("ports, port ranges and protocols", () => {
    const registry = cluster([
      "web",
      (n) => web(n).to(n.nodes, tcp(80, [9000, 9100]), udp(53)),
    ]);
    assert.deepEqual(policies(registry).web.spec.egress[0].toPorts, [
      {
        ports: [
          { port: "80", protocol: "TCP" },
          { port: "9000", endPort: 9100, protocol: "TCP" },
          { port: "53", protocol: "UDP" },
        ],
      },
    ]);
  });

  test("a rule with no ports allows the peer on every port, so has no ports section", () => {
    const registry = cluster(["web", (n) => web(n).to(n.nodes, icmpv4(8))]);
    const [rule] = policies(registry).web.spec.egress;
    assert.equal("toPorts" in rule, false);
    assert.ok(rule.icmps);
  });

  test("a dns wildcard lets the subject resolve any name through the ports it is given", () => {
    const registry = cluster([
      "web",
      (n) => web(n).to(n.nodes, tcp(53), dnsWildcard()),
    ]);
    assert.deepEqual(policies(registry).web.spec.egress[0].toPorts[0].rules, {
      dns: [{ matchPattern: "*" }],
    });
  });

  test("icmp", () => {
    const registry = cluster(["web", (n) => web(n).to(n.nodes, icmpv4(3, 8))]);
    assert.deepEqual(policies(registry).web.spec.egress[0].icmps, [
      {
        fields: [
          { type: 3, family: "IPv4" },
          { type: 8, family: "IPv4" },
        ],
      },
    ]);
  });

  test("the nodes, the host and the apiserver are entities in a rule, and host policies by selector", () => {
    const registry = cluster([
      "web",
      (n) =>
        web(n)
          .to(n.nodes, tcp(1))
          .to(n.host, tcp(2))
          .to(n.kubeApiServer, tcp(3)),
    ]);
    const { web: w, nodes: nodePolicy, host: hostPolicy } = policies(registry);
    assert.deepEqual(
      w.spec.egress.map((r: any) => r.toEntities),
      [["host"], ["kube-apiserver"], ["remote-node", "host"]]
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        .map((e) => e),
    );
    assert.deepEqual(nodePolicy.spec.nodeSelector, {
      matchExpressions: [{ key: "kubernetes.io/hostname", operator: "Exists" }],
    });
    assert.deepEqual(
      hostPolicy.spec.nodeSelector,
      nodePolicy.spec.nodeSelector,
    );
  });

  test("a component and a gateway select by their labels", () => {
    const registry = new PolicyRegistry();
    const n = registry.network("x");
    const c = n.subject("c", component("controller", "ns"));
    const g = n.subject("g", gateway("family"));
    g.to(c, tcp(1));
    const { c: cp, g: gp } = policies(registry);
    assert.deepEqual(cp.spec.endpointSelector, {
      matchLabels: {
        "k8s:io.kubernetes.pod.namespace": "ns",
        "k8s:app.kubernetes.io/component": "controller",
      },
    });
    assert.deepEqual(gp.spec.endpointSelector, {
      matchLabels: {
        "k8s:gateway.envoyproxy.io/owning-gateway-name": "family",
        "k8s:io.kubernetes.pod.namespace": "envoy-gateway",
      },
    });
  });

  test("a pod in any namespace selects by name alone", () => {
    const registry = new PolicyRegistry();
    registry
      .network("x")
      .subject("job", pod("job", "*"))
      .to(cidrs("10.0.0.0/8"), tcp(1));
    assert.deepEqual(policies(registry).job.spec.endpointSelector, {
      matchLabels: { "k8s:app.kubernetes.io/name": "job" },
    });
  });
});

describe("the output", () => {
  test("leaves out subjects nothing was allowed to or from", () => {
    const registry = cluster(["web", (n) => web(n)], ["db", (n) => db(n)]);
    assert.deepEqual(registry.objects(), []);
  });

  test("is in the same order however the apps and their edges are arranged", () => {
    const declarations: [
      string,
      (n: ReturnType<PolicyRegistry["network"]>) => void,
    ][] = [
      [
        "web",
        (n) =>
          web(n)
            .to(n.ref("db"), tcp(5432))
            .to(n.kubeApiServer, tcp(6443))
            .to(cidrs("10.0.0.0/8"), tcp(1)),
      ],
      ["db", (n) => db(n).to(n.nodes, tcp(2))],
    ];
    const forward = cluster(...declarations).objects();
    const backward = cluster(...[...declarations].reverse()).objects();
    assert.deepEqual(forward, backward);
    assert.deepEqual(
      forward.map((p) => p.metadata.name),
      ["db", "kube-apiserver", "nodes", "web"],
    );
  });
});

describe("ownership", () => {
  test("a subject is declared once, and a second declaration is an error as it is made", () => {
    assert.throws(
      () =>
        cluster(
          ["a", (n) => n.subject("web", pod("a", "a"))],
          ["b", (n) => n.subject("web", pod("b", "b"))],
        ),
      /subject 'web' is declared by a and by b/,
    );
  });

  test("two subjects can't select the same pods", () => {
    const registry = cluster(
      ["a", (n) => n.subject("one", pod("x", "x"))],
      ["b", (n) => n.subject("two", pod("x", "x"))],
    );
    assert.throws(
      () => registry.objects(),
      /'one' and 'two' \(b\) select the same pods/,
    );
  });

  test("an edge is declared by one app: declaring it twice is an error that names both", () => {
    const registry = cluster(
      ["web", (n) => web(n).to(n.ref("db"), tcp(5432))],
      ["db", (n) => db(n).from(n.ref("web"), tcp(5432))],
    );
    assert.throws(() => registry.objects(), /is declared by web and by db/);
  });

  test("the same two subjects may be allowed different things", () => {
    const registry = cluster(
      ["web", (n) => web(n).to(n.ref("db"), tcp(5432))],
      ["db", (n) => db(n).from(n.ref("web"), tcp(5433))],
    );
    assert.doesNotThrow(() => registry.objects());
  });
});
