import type { AppFunction } from "../../tools/lib/app.ts";
import {
  cidrs,
  gateway,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

// each vlan's gateway gets a fixed address from the cilium load balancer pool
const staticIps = {
  family: "192.168.33.2",
  personal: "192.168.33.3",
  infrastructure: "192.168.33.4",
  friends: "192.168.33.7",
};

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  ns.add({
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "GatewayClass",
    metadata: { name: "default" },
    spec: { controllerName: "gateway.envoyproxy.io/gatewayclass-controller" },
  });

  for (const [name, staticIp] of Object.entries(staticIps)) {
    ns.add({
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "Gateway",
      metadata: { name },
      spec: {
        gatewayClassName: "default",
        infrastructure: {
          annotations: { "lbipam.cilium.io/ips": staticIp },
        },
        allowedListeners: {
          namespaces: { from: "All" },
        },
        listeners: [
          {
            name: "placeholder",
            port: 80,
            protocol: "HTTP",
            allowedRoutes: {
              namespaces: {
                from: "Selector",
                selector: {
                  matchExpressions: [
                    { key: "homelab/does-not-exist", operator: "Exists" },
                  ],
                },
              },
            },
          },
        ],
      },
    });
  }
};

export const network: NetworkFunction = (n) => {
  const family = n.subject("gateway-family", gateway("family"));
  const personal = n.subject("gateway-personal", gateway("personal"));
  const friends = n.subject("gateway-friends", gateway("friends"));
  const infrastructure = n.subject(
    "gateway-infrastructure",
    gateway("infrastructure"),
  );

  family.from(
    cidrs(
      "192.168.8.0/24",
      "192.168.9.0/24",
      "192.168.16.0/24",
      "192.168.17.0/24",
      // iot devices individually allowed past the vlan's isolation (iot_allow_intranet)
      "192.168.24.2/32",
      "192.168.24.3/32",
      "192.168.24.4/32",
      "192.168.24.6/32",
      "192.168.24.7/32",
      "192.168.24.14/32",
    ),
    tcp(8097, 10443),
  );
  personal.from(
    cidrs("192.168.16.0/24", "192.168.17.0/24", "192.168.34.0/24"),
    tcp(10443),
  );
  friends.from(
    cidrs(
      "192.168.8.0/24",
      "192.168.9.0/24",
      "192.168.16.0/24",
      "192.168.17.0/24",
      "192.168.40.0/24",
      "192.168.41.0/24",
      // iot devices individually allowed past the vlan's isolation (iot_allow_intranet)
      "192.168.24.2/32",
      "192.168.24.3/32",
      "192.168.24.4/32",
      "192.168.24.6/32",
      "192.168.24.7/32",
      "192.168.24.14/32",
    ),
    tcp(10443),
  );
  infrastructure.from(cidrs("192.168.34.0/24"), tcp(10443));
};
