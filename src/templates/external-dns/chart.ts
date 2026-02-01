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

  const vaultAuth = new VaultAuth(chart, chart.node.id, "vault");

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "vault",
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

  const helm = new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
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
    sources: ["gateway-httproute"],
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "external-dns",
    }),
  );
  return chart;
};
