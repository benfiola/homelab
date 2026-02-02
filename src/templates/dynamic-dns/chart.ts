import { ConfigMap, Deployment } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  getField,
  getSecurityContext,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { textblock } from "../../strings";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const vaultAuth = new VaultAuth(
    chart,
    chart.node.id,
    "vault-secrets-operator",
  );

  const secret = new VaultStaticSecret(
    chart,
    vaultAuth,
    "vault",
    chart.node.id,
  );

  const interval = 300;
  const cloudflareZone = "bfiola.dev";
  const ttl = 300;
  const domains = ["wireguard.bfiola.dev"].join(",");

  const configMap = new ConfigMap(chart, `${id}-config-map`, {
    data: {
      "ddclient.conf": textblock`
        daemon=${interval}
        use=web,ssl=yes,web=https://cloudflare.com/cdn-cgi/trace
        protocol=cloudflare,zone=${cloudflareZone},ttl=${ttl},login=token,password_env=CLOUDFLARE_API_TOKEN ${domains}
      `,
    },
  });

  const securityContext = getSecurityContext();

  const deployment = new Deployment(chart, `${id}-deployment`, {
    metadata: {
      name: "dynamic-dns",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "dynamic-dns",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "dynamic-dns",
          },
        },
        spec: {
          initContainers: [
            {
              name: "copy-config",
              image: "alpine:3.23.2",
              args: [
                "cp",
                "/config-map/ddclient.conf",
                "/config/ddclient.conf",
              ],
              securityContext: securityContext.container,
              volumeMounts: [
                {
                  name: "config",
                  mountPath: "/config",
                },
                {
                  name: "config-map",
                  mountPath: "/config-map",
                },
              ],
            },
          ],
          containers: [
            {
              name: "ddclient",
              image: "ghcr.io/linuxserver/ddclient:latest",
              env: [
                {
                  name: "CLOUDFLARE_API_TOKEN",
                  valueFrom: {
                    secretKeyRef: {
                      name: getField(secret.secret, "spec.destination.name"),
                      key: "cloudflare-api-token",
                    },
                  },
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [
                {
                  name: "config",
                  mountPath: "/config",
                },
              ],
            },
          ],
          securityContext: securityContext.pod,
          volumes: [
            { name: "config", emptyDir: {} },
            { name: "config-map", configMap: { name: configMap.name } },
          ],
        },
      },
    },
  });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
