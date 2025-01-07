import { Chart } from "cdk8s";
import { AccessClaim } from "../resources/access-operator/bfiola.dev";
import { Namespace, Service } from "../resources/k8s/k8s";
import { CliContext, ManifestsCallback } from "../utils/CliContext";
import { createDeployment } from "../utils/createDeployment";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createMinioBucketAdminPolicy } from "../utils/createMinioBucketAdminPolicy";
import { createMinioPolicyBinding } from "../utils/createMinioPolicyBinding";
import { createMinioUser } from "../utils/createMinioUser";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createPersistentVolumeClaim } from "../utils/createPersistentVolumeClaim";
import { createSealedSecret } from "../utils/createSealedSecret";
import { createServiceAccount } from "../utils/createServiceAccount";
import { createVolumeBackupConfig } from "../utils/createVolumeBackupConfig";
import { getDnsAnnotation } from "../utils/getDnsLabel";
import { getPodLabels } from "../utils/getPodLabels";
import { parseEnv } from "../utils/parseEnv";

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    ESCAPE_FROM_TARKOV_ACCESS_PASSWORD: zod.string(),
    ESCAPE_FROM_TARKOV_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "escape-from-tarkov", {
    namespace: "escape-from-tarkov",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { homeNetwork: null },
      to: {
        pod: "escape-from-tarkov",
        ports: [
          [6969, "tcp"],
          [26969, "udp"],
        ],
      },
    },

    {
      from: { pod: "escape-from-tarkov" },
      to: {
        externalPod: ["minio", "minio-tenant"],
        ports: [[9000, "tcp"]],
      },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  const minioUser = await createMinioUser(
    chart,
    "escape-from-tarkov",
    env.ESCAPE_FROM_TARKOV_MINIO_SECRET_KEY
  );
  const minioBucket = createMinioBucket(chart, "escape-from-tarkov");
  const minioPolicy = createMinioBucketAdminPolicy(chart, minioBucket.name);
  createMinioPolicyBinding(chart, minioPolicy.name, minioUser.name);

  const serviceAccount = createServiceAccount(chart, "service-account", {
    access: {},
    name: "escape-from-tarkov",
  });

  const dataVolume = createPersistentVolumeClaim(chart, "pvc", {
    name: "escape-from-tarkov-data",
    size: "1Gi",
  });

  await createVolumeBackupConfig(chart, { pvc: dataVolume.name, user: 1000 });

  const serverSecret = await createSealedSecret(chart, "secret", {
    metadata: { namespace: chart.namespace, name: "escape-from-tarkov" },
    stringData: {
      EMPTY: "1",
    },
  });

  const deployment = createDeployment(chart, "deployment", {
    containers: [
      {
        envFrom: [serverSecret],
        image: "benfiola/escape-from-tarkov:0.1.3-spt3.10.5-fika2.3.6",
        imagePullPolicy: "Always",
        mounts: {
          data: "/data",
        },
        name: "escape-from-tarkov",
        ports: {
          server: [6969, "tcp"],
          p2p: [25565, "udp"],
        },
        resources: {
          cpu: 2000,
          mem: 2000,
        },
      },
    ],
    name: "escape-from-tarkov",
    namespace: chart.namespace,
    serviceAccount: serviceAccount.name,
    updateStrategy: "Recreate",
    user: 1000,
    volumes: {
      data: dataVolume,
    },
  });

  new Service(chart, "service", {
    metadata: {
      namespace: chart.namespace,
      name: "escape-from-tarkov",
      annotations: getDnsAnnotation("eft.bulia"),
    },
    spec: {
      type: "LoadBalancer",
      ports: [
        { name: "server", port: 6969, protocol: "TCP" },
        {
          name: "p2p",
          port: 26969,
          targetPort: { value: "25565" } as any,
          protocol: "UDP",
        },
      ],
      selector: getPodLabels(deployment.name),
    },
  });

  const accessSecret = await createSealedSecret(chart, "access-secret", {
    metadata: { namespace: chart.namespace, name: "escape-from-tarkov-access" },
    stringData: {
      password: env.ESCAPE_FROM_TARKOV_ACCESS_PASSWORD,
    },
  });

  new AccessClaim(chart, "access", {
    metadata: {
      namespace: chart.namespace,
      name: "escape-from-tarkov",
    },
    spec: {
      dns: "eft.bfiola.dev",
      passwordRef: {
        key: "password",
        name: accessSecret.name,
      },
      serviceTemplates: [
        {
          type: "LoadBalancer",
          ports: [
            { name: "server", port: 6969, protocol: "TCP" },
            {
              name: "p2p",
              port: 26969,
              targetPort: { value: "25565" } as any,
              protocol: "UDP",
            },
          ],
          selector: getPodLabels(deployment.name),
        },
      ],
      ttl: "168h",
    },
  });

  return chart;
};

export default async function (context: CliContext) {
  context.manifests(manifests);
}
