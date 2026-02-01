import {
  Chart,
  findApiObject,
  getField,
  getSecurityContext,
  Helm,
  Namespace,
  VaultAuth,
  VaultDynamicSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(
    chart,
    chart.node.id,
    "vault-secrets-operator",
  );

  const vaultSecret = new VaultDynamicSecret(
    chart,
    vaultAuth,
    "vault",
    chart.node.id,
    {
      RELAYHOST_PASSWORD: `{{ get (get .Secrets "data") "mailgun-smtp-password" }}`,
    },
  );

  const securityContext = getSecurityContext({
    caps: [
      "DAC_OVERRIDE",
      "NET_BIND_SERVICE",
      "SYS_CHROOT",
      "SETGID",
      "SETUID",
    ],
    uid: 0,
    gid: 0,
  });

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    config: {
      general: {
        ALLOW_EMPTY_SENDER_DOMAINS: "true",
        RELAYHOST: "[smtp.mailgun.org]:587",
        RELAYHOST_USERNAME: "noreply@cluster.bulia.dev",
      },
    },
    existingSecret: getField(vaultSecret.secret, "spec.destination.name"),
    container: {
      postfix: {
        securityContext: securityContext.container,
      },
    },
    persistence: {
      enabled: false,
    },
    pod: {
      annotations: {
        "app.kubernetes.io/name": "postfix",
      },
      securityContext: securityContext.pod,
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "postfix-mail",
    }),
  );

  return chart;
};
