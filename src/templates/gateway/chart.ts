import {
  Gateway,
  GatewayClass,
  GatewaySpecAllowedListenersNamespacesFrom as AllowedListenersNamespacesFrom,
  GatewaySpecListenersAllowedRoutesNamespacesFrom as AllowedRoutesNamespacesFrom,
} from "../../../assets/gateway-api/gateway.networking.k8s.io";
import { Chart, gateways, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const gatewayClass = new GatewayClass(chart, `${id}-gateway-class`, {
    metadata: {
      name: "default",
    },
    spec: {
      controllerName: "gateway.envoyproxy.io/gatewayclass-controller",
    },
  });

  const staticIps: Record<(typeof gateways)[number], string> = {
    family: "192.168.33.2",
    personal: "192.168.33.3",
    infrastructure: "192.168.33.4",
    friends: "192.168.33.7",
  };

  for (const name of gateways) {
    const staticIp = staticIps[name];
    const infrastructure = {
      annotations: {
        "lbipam.cilium.io/ips": staticIp,
      },
    };

    new Gateway(chart, `${id}-gateway-${name}`, {
      metadata: {
        name,
      },
      spec: {
        gatewayClassName: gatewayClass.name,
        infrastructure,
        allowedListeners: {
          namespaces: { from: AllowedListenersNamespacesFrom.ALL },
        },
        listeners: [
          {
            name: "placeholder",
            port: 80,
            protocol: "HTTP",
            allowedRoutes: {
              namespaces: {
                from: AllowedRoutesNamespacesFrom.SELECTOR,
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

  return chart;
};
