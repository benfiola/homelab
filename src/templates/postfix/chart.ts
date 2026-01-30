import {
  ConfigMap,
  Deployment,
  IntOrString,
  Service,
} from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getField,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart, { privileged: true });

  const vaultAuth = new VaultAuth(chart, "vault");

  const vaultSecret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "vault",
    construct.node.id,
  );

  const configMap = new ConfigMap(chart, `${id}-config-map`, {
    metadata: {
      name: "config",
    },
    data: {
      "mailgun-smtp-username": "noreply@cluster.bulia.dev",
    },
  });

  const deployment = new Deployment(chart, `${id}-deployment`, {
    metadata: {
      name: "postfix",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "postfix",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "postfix",
          },
        },
        spec: {
          containers: [
            {
              name: "postfix",
              image: `docker.io/boky/postfix:4.4.0`,
              env: [
                {
                  name: "ALLOW_EMPTY_SENDER_DOMAINS",
                  value: "true",
                },
                {
                  name: "RELAYHOST",
                  value: "[smtp.mailgun.org]:587",
                },
                {
                  name: "RELAYHOST_USERNAME",
                  valueFrom: {
                    configMapKeyRef: {
                      name: configMap.name,
                      key: "mailgun-smtp-username",
                    },
                  },
                },
                {
                  name: "RELAYHOST_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: getField(
                        vaultSecret.secret,
                        "spec.destination.name",
                      ),
                      key: "mailgun-smtp-password",
                    },
                  },
                },
              ],
              ports: [
                {
                  containerPort: 587,
                },
              ],
            },
          ],
        },
      },
    },
  });

  new Service(chart, `${id}-service`, {
    metadata: {
      name: "postfix",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": "postfix",
      },
      ports: [
        {
          port: 587,
          targetPort: IntOrString.fromNumber(587),
          protocol: "TCP",
        },
      ],
    },
  });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
