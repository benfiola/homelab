import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GrpcRoute, HttpRoute, tcpRoute, udpRoute } from "./routes.ts";

describe("GrpcRoute", () => {
  const rules = (...matches: Parameters<GrpcRoute["match"]>[2][]) => {
    const route = new GrpcRoute("family", "grpc.example.test");
    route.match({ kind: "Service", name: "svc" }, 50051, ...matches);
    return route.objects().find((o) => o.kind === "GRPCRoute")!.spec.rules;
  };

  test("without a match, sends everything to the service", () => {
    const [rule] = rules();
    assert.equal("matches" in rule, false);
    assert.deepEqual(rule.backendRefs, [
      { kind: "Service", name: "svc", port: 50051 },
    ]);
  });

  test("a rule per match, each matching on its service or method", () => {
    assert.deepEqual(
      rules({ service: "a.B" }, { method: "Get", type: "Exact" }).map(
        (r: any) => r.matches[0].method,
      ),
      [{ service: "a.B" }, { method: "Get", type: "Exact" }],
    );
  });

  test("a match that names neither is no match", () => {
    const [rule] = rules({ type: "Exact" });
    assert.equal("matches" in rule, false);
  });
});

describe("HttpRoute", () => {
  const objects = (...matches: Parameters<HttpRoute["match"]>[2][]) =>
    new HttpRoute("family", "app.example.test")
      .match({ kind: "Service", name: "svc" }, 80, ...matches)
      .objects();

  test("is served over https, with a certificate for the hostname", () => {
    const [listeners] = objects();
    const [listener] = listeners.spec.listeners;
    assert.equal(listener.protocol, "HTTPS");
    assert.equal(listener.port, 443);
    assert.equal(listener.tls.mode, "Terminate");
    assert.deepEqual(listener.tls.certificateRefs, [
      { name: "app-example-test-tls" },
    ]);
    assert.equal(
      listeners.metadata.annotations["cert-manager.io/cluster-issuer"],
      "cloudflare",
    );
  });

  test("a rule with no match is the root path, and a timeout is only there if given", () => {
    const [, route] = objects();
    assert.deepEqual(route.spec.rules, [
      {
        backendRefs: [{ kind: "Service", name: "svc", port: 80 }],
        matches: [{ path: { type: "PathPrefix", value: "/" } }],
      },
    ]);
    const [, timed] = objects({
      path: "/api",
      pathType: "Exact",
      timeout: "30s",
    });
    assert.equal(timed.spec.rules[0].timeouts.request, "30s");
    assert.deepEqual(timed.spec.rules[0].matches, [
      { path: { type: "Exact", value: "/api" } },
    ]);
  });
});

describe("GrpcRoute timeouts", () => {
  test("a timeout adds a backend traffic policy, and none adds nothing", () => {
    const kinds = (timeout?: string) =>
      new GrpcRoute("family", "g.example.test", { timeout })
        .match({ kind: "Service", name: "svc" }, 1)
        .objects()
        .map((o) => o.kind);
    assert.deepEqual(kinds(), ["ListenerSet", "GRPCRoute"]);
    assert.deepEqual(kinds("1m"), [
      "ListenerSet",
      "GRPCRoute",
      "BackendTrafficPolicy",
    ]);
  });
});

describe("tcpRoute and udpRoute", () => {
  const to = { kind: "Service", name: "svc" };

  test("a port on a hostname, with no tls, and a listener named for the protocol", () => {
    const [tcpListeners, tcp] = tcpRoute(
      "family",
      "h.example.test",
      22,
      to,
      2222,
    );
    const [udpListeners, udp] = udpRoute(
      "family",
      "h.example.test",
      53,
      to,
      5353,
    );
    assert.equal(tcpListeners.spec.listeners[0].protocol, "TCP");
    assert.equal(udpListeners.spec.listeners[0].protocol, "UDP");
    assert.equal("tls" in tcpListeners.spec.listeners[0], false);
    assert.equal(
      "annotations" in tcpListeners.metadata,
      false,
      "no certificate is issued",
    );
    assert.equal(tcpListeners.metadata.name, "h.example.test-tcp-22");
    assert.equal(udpListeners.metadata.name, "h.example.test-udp-53");
    assert.equal(tcp.metadata.name, "h.example.test-22");
    assert.deepEqual(tcp.spec.rules[0].backendRefs, [
      { kind: "Service", name: "svc", port: 2222 },
    ]);
    assert.equal(udp.spec.rules[0].backendRefs[0].port, 5353);
  });
});
