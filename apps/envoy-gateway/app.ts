import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm("oci://docker.io/envoyproxy/gateway-crds-helm?version=v1.9.3", {
    release: "envoy-gateway",
    values: { crds: { envoyGateway: { enabled: true } } },
  });

  await ns.helm("oci://docker.io/envoyproxy/gateway-helm?version=v1.9.3", {
    release: "envoy-gateway",
    values: {
      certgen: {
        job: {
          pod: { labels: { "app.kubernetes.io/component": "certgen" } },
          ttlSecondsAfterFinished: null,
        },
      },
      deployment: {
        envoyGateway: {
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: null,
          },
        },
        pod: { labels: { "app.kubernetes.io/component": "controller" } },
      },
    },
    crds: false,
  });

  ns.vpa({ kind: "Deployment", name: "envoy-gateway" }, { advisory: true });
};

export const network: NetworkFunction = (n) => {
  const envoyGatewayCertgen = n.subject(
    "envoy-gateway-certgen",
    component("certgen", "envoy-gateway"),
  );
  const envoyGatewayController = n.subject(
    "envoy-gateway-controller",
    component("controller", "envoy-gateway"),
  );
  const envoyGatewayProxy = n.subject(
    "envoy-gateway-proxy",
    component("proxy", "envoy-gateway"),
  );

  envoyGatewayCertgen.to(n.kubeApiServer, tcp(6443));
  n.controlPlane.to(envoyGatewayController, tcp(9443));
  envoyGatewayController.to(n.kubeApiServer, tcp(6443));
  n.host.to(envoyGatewayController, tcp(8081));
  n.host.to(envoyGatewayProxy, tcp(19002, 19003));
  n.ref("gateway-family").to(envoyGatewayController, tcp(18000));
  n.ref("gateway-personal").to(envoyGatewayController, tcp(18000));
  n.ref("gateway-friends").to(envoyGatewayController, tcp(18000));
  n.ref("gateway-infrastructure").to(envoyGatewayController, tcp(18000));
};
