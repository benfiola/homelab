import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://bokysan.github.io/docker-postfix/mail?version=5.2.0", {
    release: "postfix",
    values: "values.yaml",
  });

  h.namespace({ privileged: true });

  h.templatedSecrets("secrets", {
    RELAYHOST_PASSWORD: h.secretRef("mailgun-smtp-password"),
  });

  h.vpa({ kind: "StatefulSet", name: "postfix-mail" });
};

export const network: NetworkFunction = (n) => {
  const postfix = n.subject("postfix", pod("mail", "postfix"));

  postfix.to(dns("smtp.mailgun.org"), tcp(587));
};
