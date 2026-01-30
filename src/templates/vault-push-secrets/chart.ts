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

  const vaultAuth = new VaultAuth(chart, "vault");

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "vault",
    construct.node.id,
  );

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      gcsCredentialsSecret: getField(
        vaultSecret.secret,
        "spec.destination.name",
      ),
      gcsCredentialsKey: "google-cloud-credentials-file",
      gcsDestination: "gs://homelab-8hxm62/secrets-apps.yaml",
      vaultAddr: "http://vault-active.vault.svc:8200",
      vaultAuthMount: "kubernetes/",
      vaultAuthRole: "vault-push-secrets-workload",
      vaultSecretsMount: "secrets/",
    },
    serviceAccount: {
      name: "workload",
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
