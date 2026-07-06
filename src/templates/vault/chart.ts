import {
  Chart,
  findApiObject,
  getSecurityContext,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { textblock } from "../../strings";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const securityContext = getSecurityContext();

  new Helm(chart, `${id}-helm`, context.getAsset("chart.tar.gz"), {
    injector: {
      enabled: false,
    },
    server: {
      audit: {
        enabled: true,
      },
      auditStorage: {
        enabled: true,
        storageClass: "standard",
      },
      dataStorage: {
        storageClass: "standard",
      },
      extraContainers: [
        {
          env: [
            {
              name: "VAULT_UNSEAL_KEY",
              value: "/vault/data/unseal-key",
            },
            {
              name: "VAULT_ADDR",
              value: "http://127.0.0.1:8200",
            },
          ],
          image: "ghcr.io/benfiola/homelab-images/vault-unseal:1.0.2",
          name: "vault-unseal",
          securityContext: securityContext.container,
          volumeMounts: [
            {
              name: "data",
              mountPath: "/vault/data",
              readOnly: true,
            },
          ],
        },
      ],
      ha: {
        enabled: true,
        raft: {
          enabled: true,
          config: textblock`
            ui = true

            listener "tcp" {
              tls_disable = 1
              address = "[::]:8200"
              cluster_address = "[::]:8201"
            }

            storage "raft" {
              path = "/vault/data"
              retry_join {
                leader_api_addr = "http://vault-0.vault-internal:8200"
              }
            }

            service_registration "kubernetes" {}

            disable_mlock = true
          `,
        },
        replicas: 3,
      },
      statefulSet: {
        securityContext: {
          container: securityContext.container,
          pod: securityContext.pod,
        },
      },
      updateStrategyType: "RollingUpdate",
    },
    ui: {
      enabled: true,
    },
  });

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "StatefulSet",
      name: "vault",
    }),
  );

  return chart;
};
