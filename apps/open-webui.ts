import { Chart, Helm } from "cdk8s";
import { ConfigMap, Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createIngress } from "../utils/createIngress";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import {
  createNetworkPolicy,
  createTargets,
} from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { getCertIssuerAnnotations } from "../utils/getCertIssuerAnnotation";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getIngressClassName } from "../utils/getIngressClassName";
import { getPodLabels } from "../utils/getPodLabels";
import { getPodRequests } from "../utils/getPodRequests";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";
import { getStorageClassName } from "../utils/getStorageClassName";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  helm: {
    chart: "open-webui",
    repo: "https://helm.openwebui.com/",
    version: "6.23.0",
  },
  frpVersion: "0.63.0",
  wolProxyVersion: "1.0.0",
};

const namespace = "open-webui";

const policyTargets = createTargets((b) => ({
  pipelines: b.pod(namespace, "open-webui-pipelines", { api: [9099, "tcp"] }),
  postgresPrimary: b.pod(namespace, "open-webui-postgres-primary", {
    tcp: [5432, "tcp"],
  }),
  postgresRead: b.pod(namespace, "open-webui-postgres-read", {
    tcp: [5432, "tcp"],
  }),
  proxy: b.pod(namespace, "proxy", {
    api: [80, "tcp"],
  }),
  redis: b.pod(namespace, "open-webui-redis", { tcp: [6379, "tcp"] }),
  server: b.pod(namespace, "open-webui", { http: [8080, "tcp"] }),
  tunnel: b.pod(namespace, "tunnel", {
    client: [80, "tcp"],
    server: [8080, "tcp"],
  }),
}));

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((z) => ({
    OPEN_WEBUI_MINIO_SECRET_KEY: z.string(),
    OPEN_WEBUI_POSTGRES_PASSWORD: z.string(),
    OPEN_WEBUI_SECRET_KEY: z.string(),
  }));

  const chart = new Chart(app, "chart", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const desktop = b.target({
      dns: "bfiola-desktop.bulia.dev",
      ports: { wol: [9, "udp"] },
    });
    const homeNetwork = b.target({
      cidr: "192.168.0.0/16",
    });
    const ingress = b.target({
      entity: "ingress",
      ports: { clients: [1, 65535, "tcp"] },
    });

    b.rule(homeNetwork, pt.tunnel, "server");
    b.rule(ingress, pt.server, "http");
    b.rule(ingress, pt.proxy, "api");
    b.rule(pt.proxy, desktop, "wol");
    b.rule(pt.proxy, pt.tunnel, "client");
    b.rule(pt.postgresRead, pt.postgresPrimary, "tcp");
    b.rule(pt.server, ingress, "clients");
    b.rule(pt.server, pt.proxy, "api");
    b.rule(pt.server, pt.pipelines, "api");
    b.rule(pt.server, pt.postgresPrimary, "tcp");
    b.rule(pt.server, pt.redis, "tcp");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
      labels: getPrivilegedNamespaceLabels(),
    },
  });

  const tunnelSa = createServiceAccount(chart, "tunnel-sa", {
    access: {},
    name: "tunnel",
  });

  const tunnelConfig = new ConfigMap(chart, "tunnel-cm", {
    metadata: { name: "tunnel" },
    data: {
      "config.json": JSON.stringify(
        {
          bindPort: 8080,
        },
        null,
        2
      ),
    },
  });

  const tunnelDeployment = createDeployment(chart, "tunnel-deployment", {
    containers: [
      {
        name: "frp",
        image: `fatedier/frps:v${appData.frpVersion}`,
        args: ["--config", "/config/config.json"],
        ports: {
          client: [80, "tcp"],
          server: [8080, "tcp"],
        },
        mounts: {
          config: "/config",
        },
      },
    ],
    name: "tunnel",
    serviceAccount: tunnelSa.name,
    volumes: {
      config: tunnelConfig,
    },
  });

  const tunnelClientService = new Service(chart, "tunnel-client-service", {
    metadata: { name: "tunnel-client" },
    spec: {
      ports: [
        {
          targetPort: { value: 80 },
          port: 80,
          name: "client",
        },
      ],
      selector: getPodLabels(tunnelDeployment.name),
    },
  });

  new Service(chart, "tunnel-server-service", {
    metadata: {
      name: "tunnel-server",
      annotations: getDnsAnnotation("tunnel.ai.bulia.dev"),
    },
    spec: {
      ports: [
        {
          targetPort: { value: 8080 },
          port: 80,
          name: "server",
        },
      ],
      selector: getPodLabels(tunnelDeployment.name),
      type: "LoadBalancer",
    },
  });

  const proxySa = createServiceAccount(chart, "proxy-sa", {
    access: {},
    name: "proxy",
  });

  const proxyDeployment = createDeployment(chart, "proxy-deployment", {
    containers: [
      {
        name: "wol-proxy",
        image: `benfiola/homelab-wol-proxy:${appData.wolProxyVersion}`,
        env: {
          WOLPROXY_ADDRESS: "0.0.0.0:80",
          WOLPROXY_BACKEND: `${tunnelClientService.name}.${namespace}.svc:80`,
          WOLPROXY_WOL_HOSTNAME: "bfiola-desktop.bulia.dev",
          WOLPROXY_WOL_MAC_ADDRESS: "C8:7F:54:6C:10:46",
        },
        ports: {
          api: [80, "tcp"],
        },
      },
    ],
    name: "proxy",
    serviceAccount: proxySa.name,
  });

  const proxyService = new Service(chart, "proxy-service", {
    metadata: { name: "proxy" },
    spec: {
      ports: [
        {
          targetPort: { value: 80 },
          port: 80,
          name: "proxy",
        },
      ],
      selector: getPodLabels(proxyDeployment.name),
    },
  });

  createIngress(chart, "api-ingress", {
    name: "api",
    host: "api.ai.bulia.dev",
    services: { "/": { name: proxyService.name, port: "proxy" } },
  });

  const postgresSecret = await createSealedSecret(chart, "postgres-secret", {
    metadata: {
      name: "postgresql",
      namespace: chart.namespace,
    },
    stringData: {
      password: env.OPEN_WEBUI_POSTGRES_PASSWORD,
      "replication-password": env.OPEN_WEBUI_POSTGRES_PASSWORD,
    },
  });

  const s3SecretKey = "s3-secret-key";
  const secret = await createSealedSecret(chart, "open-webui-secret", {
    metadata: {
      name: "open-webui",
      namespace: chart.namespace,
    },
    stringData: {
      "database-url": `postgresql://open-webui:${env.OPEN_WEBUI_POSTGRES_PASSWORD}@open-webui-postgres-primary-hl:5432/open-webui`,
      [s3SecretKey]: env.OPEN_WEBUI_MINIO_SECRET_KEY,
      "secret-key": env.OPEN_WEBUI_SECRET_KEY,
    },
  });

  const minioUser = await createMinioUser(
    chart,
    "open-webui",
    env.OPEN_WEBUI_MINIO_SECRET_KEY
  );
  const minioBucket = createMinioBucket(chart, "open-webui");
  createMinioBucketAdminPolicy(chart, minioBucket.name);
  createMinioPolicyBinding(chart, minioBucket.name, minioUser.name);

  new Helm(chart, "helm", {
    ...appData.helm,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      extraEnvVars: [
        {
          // attempts to locally download models if operating in online mode
          name: "OFFLINE_MODE",
          value: "True",
        },
        {
          // no way to instruct helm chart to use existing secret
          name: "DATABASE_URL",
          valueFrom: {
            secretKeyRef: {
              name: secret.name,
              key: "database-url",
            },
          },
        },
        {
          // if not persistent, will require re-authentication on pod restart
          name: "WEBUI_SECRET_KEY",
          valueFrom: {
            secretKeyRef: {
              name: secret.name,
              key: "secret-key",
            },
          },
        },
      ],
      // give resources a consistent name
      fullnameOverride: "open-webui",
      // enable tls-ingress to the webui frontend
      ingress: {
        annotations: getCertIssuerAnnotations(),
        class: getIngressClassName(),
        enabled: true,
        existingSecret: "open-webui-tls",
        host: "ai.bulia.dev",
        tls: true,
      },
      logging: {
        level: "debug",
      },
      ollama: {
        enabled: false,
      },
      // use tunnel api url
      openaiBaseApiUrls: `http://${proxyService.name}.${namespace}.svc/v1`,
      persistence: {
        // disable local persistence (use s3)
        enabled: true,
        // use s3 for persistence.
        // currently, default behavior creates a standalone pvc with a statefulset - affecting our ability to do rolling updates.
        provider: "s3",
        s3: {
          accessKey: minioUser.name,
          bucket: minioBucket.name,
          endpointUrl: "http://minio.minio.svc:9000",
          secretKeyExistingSecret: secret.name,
          secretKeyExistingSecretKey: s3SecretKey,
        },
      },
      pipelines: {
        persistence: {
          // use correct storage class for persistence
          storageClass: getStorageClassName(),
        },
      },
      postgresql: {
        // create a replicated postgres db
        architecture: "replication",
        auth: {
          // disable admin user
          enablePostgresUser: false,
          // use existing secret
          existingSecret: postgresSecret.name,
        },
        enabled: true,
        primary: {
          // disable automatic (permissive) network policy creation
          networkPolicy: {
            enabled: false,
          },
          // enable persistence.  use 'backup' because workload is already replicated and doesn't need replicated storage.
          persistence: {
            enabled: true,
            storageClass: getStorageClassName("backup"),
          },
        },
        readReplicas: {
          // disable automatic (permissive) network policy creation
          networkPolicy: {
            enabled: false,
          },
          // enable persistence.  use 'backup' because workload is already replicated and doesn't need replicated storage.
          persistence: {
            storageClass: getStorageClassName("backup"),
          },
          // set replica count
          replicaCount: 2,
        },
      },
      // ensure workload has reasonable request limits set
      resources: getPodRequests({ mem: 600 }),
      websocket: {
        // enable websocket/streaming behavior
        enabled: true,
        // create standalone redis instance for this purpose.
        // NOTE: redis-cluster option is broken re: persistence storageclass.
        redis: {
          enabled: true,
        },
      },
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
