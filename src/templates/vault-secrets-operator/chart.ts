import { VaultConnection } from "../../../assets/vault-secrets-operator/secrets.hashicorp.com";
import {
  Chart,
  findApiObject,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"));

  new VaultConnection(chart, `${id}-vault-connection`, {
    metadata: {
      name: "default",
    },
    spec: {
      address: "http://vault.vault:8200",
      skipTlsVerify: false,
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "vault-secrets-operator-controller-manager",
    }),
  );

  return chart;
};
