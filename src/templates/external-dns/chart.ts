import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  findApiObject,
  getField,
  Helm,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(
    chart,
    chart.node.id,
    "vault-secrets-operator",
  );

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "secrets",
    chart.node.id,
  );

  const configMap = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "config",
    },
    data: {
      "routeros-username": id,
    },
  });

  new Helm(chart, `${id}-helm-mikrotik`, context.getAsset("chart.tar.gz"), {
    annotationFilter: "homelab.benfiola.com/use-external-dns-mikrotik",
    nameOverride: `${id}-mikrotik`,
    policy: "sync",
    provider: {
      name: "webhook",
      webhook: {
        env: [
          {
            name: "MIKROTIK_BASEURL",
            value: "http://router.bulia",
          },
          {
            name: "MIKROTIK_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: getField(vaultSecret.secret, "spec.destination.name"),
                key: "routeros-password",
              },
            },
          },
          {
            name: "MIKROTIK_USERNAME",
            valueFrom: {
              configMapKeyRef: {
                name: configMap.name,
                key: "routeros-username",
              },
            },
          },
        ],
        image: {
          repository: "ghcr.io/mirceanton/external-dns-provider-mikrotik",
          tag: "v1.5.1",
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: {
            drop: ["ALL"],
          },
          privileged: false,
          runAsGroup: 1000,
          runAsNonRoot: true,
          runAsUser: 1000,
        },
      },
    },
    releaseName: "mikrotik",
    sources: [
      "gateway-grpcroute",
      "gateway-httproute",
      "gateway-tcproute",
      "gateway-tlsroute",
      "gateway-udproute",
    ],
  });

  new Helm(chart, `${id}-helm-cloudflare`, context.getAsset("chart.tar.gz"), {
    annotationFilter: "homelab.benfiola.com/use-external-dns-cloudflare",
    env: [
      {
        name: "CF_API_TOKEN",
        valueFrom: {
          secretKeyRef: {
            name: getField(vaultSecret.secret, "spec.destination.name"),
            key: "cloudflare-api-token",
          },
        },
      },
    ],
    nameOverride: `${id}-cloudflare`,
    policy: "sync",
    provider: {
      name: "cloudflare",
    },
    releaseName: "cloudflare",
    sources: [
      "gateway-grpcroute",
      "gateway-httproute",
      "gateway-tcproute",
      "gateway-tlsroute",
      "gateway-udproute",
    ],
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "external-dns-mikrotik",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "external-dns-cloudflare",
    }),
  );

  return chart;
};
