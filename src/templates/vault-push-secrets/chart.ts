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
      gcsCredentialsSecret: vaultSecret.name,
      gcsCredentialsKey: "google-cloud-credentials-file",
      gcsDestination: "gs://homelab-secrets-262965/secrets-apps.yaml",
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
