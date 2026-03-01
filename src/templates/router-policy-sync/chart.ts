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

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      mikrotikBaseUrl: "http://router.bulia",
      mikrotikUsername: "router-policy-sync",
      mikrotikPasswordSecret: getField(
        vaultSecret.secret,
        "spec.destination.name",
      ),
      mikrotikPasswordKey: "routeros-password",
      reservedCIDRs: ["192.168.0.0/16"],
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "router-policy-sync",
    }),
  );

  return chart;
};
