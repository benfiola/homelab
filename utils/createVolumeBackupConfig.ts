import { Chart } from "cdk8s";
import { ReplicationSource } from "../resources/volsync/volsync.backube";
import { createSealedSecret } from "./createSealedSecret";
import { getPodLabels } from "./getPodLabels";
import { getStorageClassName } from "./getStorageClassName";
import { parseEnv } from "./parseEnv";

interface CreateVolumeBackupConfigOpts {
  pvc: string;
  user: number;
}

/**
 * Creates resources associated with creating a volsync replication source (which enables pvc backups)
 * @param chart the chart to attach to
 * @param opts options to construct the backup config
 */
export const createVolumeBackupConfig = async (
  chart: Chart,
  opts: CreateVolumeBackupConfigOpts
) => {
  const env = parseEnv((zod) => ({
    VOLSYNC_ENCRYPTION_KEY: zod.string(),
    VOLSYNC_GCS_KEY_JSON: zod.string(),
  }));

  const secret = await createSealedSecret(chart, `restic-${opts.pvc}`, {
    metadata: {
      namespace: chart.namespace,
      name: `restic-${opts.pvc}`,
    },
    stringData: {
      RESTIC_REPOSITORY: `gs:volsync-x8nj3a:/${chart.namespace}/${opts.pvc}`,
      RESTIC_PASSWORD: env.VOLSYNC_ENCRYPTION_KEY,
      GOOGLE_PROJECT_ID: "592515172912",
      GOOGLE_APPLICATION_CREDENTIALS: env.VOLSYNC_GCS_KEY_JSON,
    },
  });

  new ReplicationSource(chart, `replications-source-${opts.pvc}`, {
    metadata: { namespace: chart.namespace, name: opts.pvc },
    spec: {
      restic: {
        copyMethod: "Clone" as any,
        moverPodLabels: getPodLabels("volsync-mover"),
        moverSecurityContext: {
          fsGroup: opts.user,
          fsGroupChangePolicy: "Always",
          runAsGroup: opts.user,
          runAsNonRoot: true,
          runAsUser: opts.user,
          seccompProfile: { type: "RuntimeDefault" },
        },
        pruneIntervalDays: 1,
        repository: secret.name,
        retain: {
          daily: 7,
          within: "1d",
        },
        storageClassName: getStorageClassName("backup"),
      },
      sourcePvc: opts.pvc,
      trigger: {
        schedule: "0 12 * * *",
      },
    },
  });
};
