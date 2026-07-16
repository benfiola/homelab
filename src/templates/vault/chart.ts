import { readFile } from "fs/promises";
import path from "path";
import {
  Chart,
  findApiObject,
  getSecurityContext,
  Helm,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

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
        {
          env: [
            {
              name: "ROOT_TOKEN_PATH",
              value: "/vault/data/root-token",
            },
          ],
          image: "ghcr.io/benfiola/homelab-images/vault-auth-proxy:1.0.2",
          name: "auth-proxy",
          ports: [
            {
              containerPort: 8100,
              name: "auth-proxy",
            },
          ],
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
          config: (
            await readFile(path.join(__dirname, "config.hcl"))
          ).toString(),
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
