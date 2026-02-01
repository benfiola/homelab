import { ClusterIssuer } from "../../../assets/cert-manager/cert-manager.io";
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

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      apiVersion: "controller.config.cert-manager.io/v1alpha1",
      kind: "ControllerConfiguration",
      enableGatewayAPI: true,
    },
    crds: {
      enabled: true,
      keep: false,
    },
  });

  const vaultAuth = new VaultAuth(chart, chart.node.id, "vault");

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "vault",
    construct.node.id,
  );

  new ClusterIssuer(chart, `${id}-cluster-issuer-cloudflare`, {
    metadata: {
      name: "cloudflare",
    },
    spec: {
      acme: {
        email: "benfiola@protonmail.com",
        privateKeySecretRef: {
          name: "acme-identity",
        },
        server: "https://acme-v02.api.letsencrypt.org/directory",
        solvers: [
          {
            dns01: {
              cloudflare: {
                apiTokenSecretRef: {
                  name: getField(vaultSecret.secret, "spec.destination.name"),
                  key: "cloudflare-api-token",
                },
              },
            },
          },
        ],
      },
    },
  });

  new ClusterIssuer(chart, `${id}-cluster-issuer-self-signed`, {
    metadata: {
      name: "self-signed",
    },
    spec: {
      selfSigned: {},
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "cert-manager",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "cert-manager-cainjector",
    }),
  );

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "cert-manager-webhook",
    }),
  );

  return chart;
};
