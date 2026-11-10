import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace({ privileged: true });

  await ns.helm("https://bokysan.github.io/docker-postfix/mail?version=5.2.1", {
    release: "postfix",
    values: {
      config: {
        general: {
          ALLOW_EMPTY_SENDER_DOMAINS: "true",
          RELAYHOST: "[smtp.mailgun.org]:587",
          RELAYHOST_USERNAME: "noreply@cluster.fiola.dev",
        },
      },
      existingSecret: "secrets",
      metrics: { enabled: true, serviceMonitor: { enabled: true } },
      recreateOnRedeploy: false,
      container: {
        postfix: {
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: {
              drop: ["ALL"],
              add: [
                "CHOWN",
                "DAC_OVERRIDE",
                "NET_BIND_SERVICE",
                "SYS_CHROOT",
                "SETGID",
                "SETUID",
              ],
            },
            runAsNonRoot: false,
            runAsUser: 0,
            runAsGroup: 0,
          },
        },
      },
      persistence: { enabled: false },
      pod: {
        annotations: { "app.kubernetes.io/name": "postfix" },
        securityContext: {
          fsGroup: 0,
          runAsNonRoot: false,
          runAsUser: 0,
          runAsGroup: 0,
          seccompProfile: { type: "RuntimeDefault" },
        },
      },
      resources: null,
    },
  });

  ns.templatedSecrets("secrets", {
    RELAYHOST_PASSWORD: h.secretRef("mailgun-smtp-password"),
  });

  ns.vpa({ kind: "StatefulSet", name: "postfix-mail" });
};

export const network: NetworkFunction = (n) => {
  const postfix = n.subject("postfix", pod("mail", "postfix"));

  postfix.to(dns("smtp.mailgun.org"), tcp(587));
  n.host.to(postfix, tcp(9154));
  n.ref("prometheus").to(postfix, tcp(9154));
};
