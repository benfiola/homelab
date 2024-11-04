import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { codeblock } from "../utils/codeblock";
import { createMinioBucket } from "../utils/createMinioBucket";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { createSealedSecret } from "../utils/createSealedSecret";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getPodRequests } from "../utils/getPodRequests";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";
import { parseEnv } from "../utils/parseEnv";

const appData = {
  chart: "velero",
  version: "6.1.0",
  repo: "https://vmware-tanzu.github.io/helm-charts",
};

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    VELERO_MINIO_SECRET_KEY: zod.string(),
  }));

  const chart = new Chart(app, "velero", { namespace: "velero" });

  createNetworkPolicy(chart, [
    {
      from: { pod: "node-agent" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { pod: "velero" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { pod: "velero" },
      to: { externalPod: ["minio", "minio-tenant"], ports: [[9000, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      labels: { ...getPrivilegedNamespaceLabels() },
      name: chart.namespace,
    },
  });

  const secret = await createSealedSecret(
    chart,
    "sealed-secret-velero-credentials",
    {
      metadata: {
        namespace: chart.namespace,
        name: "velero-credentials",
      },
      stringData: {
        cloud: codeblock`
        [default]
        aws_access_key_id=velero
        aws_secret_access_key=${env.VELERO_MINIO_SECRET_KEY}
        `,
      },
    }
  );

  await createMinioBucket(chart, {
    namespace: chart.namespace,
    name: "velero",
    secretKey: env.VELERO_MINIO_SECRET_KEY,
    tenantRef: {
      name: "minio-tenant",
      namespace: "minio",
    },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      // enable taking file system backups (openebs doesn't support volume snapshots)
      backupsEnabled: true,
      configuration: {
        // configure velero to store backups via a locally deployed minio clister
        backupStorageLocation: [
          {
            name: "default",
            bucket: "velero",
            provider: "aws",
            config: {
              region: "minio",
              s3ForcePathStyle: true,
              s3Url: "http://minio.minio.svc",
              publicUrl: "http://minio.bulia",
            },
          },
        ],
        // force velero to use restic (instead of kopia)
        // uploaderType: "restic",
      },
      credentials: {
        name: "cloud",
        existingSecret: secret.name,
      },
      // node agents perform file system backups
      deployNodeAgent: true,
      // give all resources a static prefix
      fullnameOverride: "velero",
      initContainers: [
        {
          // use the aws velero plugin to connect to minio
          name: "velero-plugin-for-aws",
          image: "velero/velero-plugin-for-aws:v1.9.2",
          volumeMounts: [
            {
              name: "plugins",
              mountPath: "/target",
            },
          ],
        },
      ],
      nodeAgent: {
        // constrain node agent resources
        resources: getPodRequests({ cpu: 500, mem: 1500 }),
      },
      // constrain workload resources
      resources: getPodRequests({ cpu: 500, mem: 500 }),
      // disable volume snapshots (openebs does not support volume snapshots)
      snapshotsEnabled: false,
      // do not allow velero to manage crds
      upgradeCRDs: false,
    },
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestsFile) => {
  const manifest = await exec(getHelmTemplateCommand(appData));
  await writeFile(manifestsFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
