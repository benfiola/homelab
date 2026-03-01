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
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      cloudflareApiTokenSecret: vaultSecret.name,
      cloudflareApiTokenKey: "cloudflare-api-token",
      cloudflareZones: [
        {
          name: "bfiola.dev",
          domains: ["current.bfiola.dev", "wireguard.bfiola.dev"],
        },
      ],
    },
    serviceAccount: {
      name: "dynamic-dns",
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "dynamic-dns",
    }),
  );

  return chart;
};
