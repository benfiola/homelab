import {
  Chart,
  findApiObject,
  getSecurityContext,
  Helm,
  Namespace,
  VaultAuth,
  VaultDynamicSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultDynamicSecret(chart, vaultAuth, (secretRef) => ({
    RELAYHOST_PASSWORD: secretRef("mailgun-smtp-password"),
  }));

  const securityContext = getSecurityContext({
    caps: [
      "CHOWN",
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
    existingSecret: vaultSecret.name,
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
    resources: null,
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
