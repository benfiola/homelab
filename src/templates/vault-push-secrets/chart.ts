import {
  Chart,
  findApiObject,
  Helm,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      bitwardenAccessTokenSecret: vaultSecret.name,
      bitwardenAccessTokenKey: "bitwarden-access-token",
      bitwardenSecretId: "ec62ad56-d707-4bde-a312-b4880129d86f",
      vaultAddr: "http://vault-active.vault.svc:8200",
      vaultAuthMount: "kubernetes/",
      vaultAuthRole: "vault-push-secrets-workload",
      vaultSecretsMount: "secrets/",
    },
    serviceAccount: {
      name: "vault-push-secrets",
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "vault-push-secrets",
    }),
  );

  return chart;
};
