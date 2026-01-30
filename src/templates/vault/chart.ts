import { readFile } from "fs/promises";
import { join } from "path";
import {
  Chart,
  findApiObject,
  Helm,
  HttpRoute,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { homelabHelper } from "../../homelab-helper";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const configPath = join(__dirname, "config.hcl");
  const config = await readFile(configPath);
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
          args: ["homelab-helper", "vault-unseal"],
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
          image: homelabHelper.image,
          name: "vault-unseal",
          securityContext: {
            allowPrivilegeEscalation: false,
          },
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
          config: config,
        },
        replicas: 3,
      },
      updateStrategyType: "RollingUpdate",
    },
    ui: {
      enabled: true,
    },
  });

  new HttpRoute(chart, "trusted", "vault.bulia.dev").match(
    findApiObject(chart, {
      apiVersion: "v1",
      kind: "Service",
      name: "vault-active",
    }),
    8200,
  );

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
