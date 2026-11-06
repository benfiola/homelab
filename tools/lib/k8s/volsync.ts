import { secretRef } from "./secrets.ts";
import { securityContext, type SecurityContextOptions } from "./workload.ts";

type Obj = Record<string, any>;

// the app whose section of the `apps` file holds the backup credentials
export const volsyncApp = "volsync";

// the bucket of every backup, at `/<namespace>/<pvc>` (where pvc-restore looks)
export const volsyncBucket = "homelab-volsync-697438";

// daily at noon
export const defaultSchedule = "0 12 * * *";

// restic's forget rules, not a count: the newest snapshot of each of the last `daily` days (and so on
// for the other periods), and every snapshot `within` a duration
export interface VolsyncRetain {
  hourly?: number;
  daily?: number;
  weekly?: number;
  monthly?: number;
  yearly?: number;
  within?: string;
}

export const defaultRetain: VolsyncRetain = { daily: 7, within: "1d" };

export interface VolsyncBackupOptions {
  // a cron expression
  schedule?: string;
  retain?: VolsyncRetain;
  // the user the backup runs as: the workload's, so that it can read the files
  securityContext?: SecurityContextOptions;
}

export interface VolsyncBackup {
  // the Secret the backup reads, and templates for its keys
  secret: { name: string; templates: Record<string, string> };
  source: Obj;
}

// backs up a clone of a PVC to backblaze with restic, on a schedule
export const volsyncBackup = (
  pvc: string,
  namespace: string,
  opts: VolsyncBackupOptions = {},
): VolsyncBackup => {
  const name = `volsync-mover-${pvc}`;
  return {
    secret: {
      name,
      templates: {
        B2_ACCOUNT_ID: secretRef("backblaze-application-key-id", volsyncApp),
        B2_ACCOUNT_KEY: secretRef("backblaze-application-key", volsyncApp),
        RESTIC_PASSWORD: secretRef("restic-password", volsyncApp),
        RESTIC_REPOSITORY: `b2:${volsyncBucket}:/${namespace}/${pvc}`,
      },
    },
    source: {
      apiVersion: "volsync.backube/v1alpha1",
      kind: "ReplicationSource",
      metadata: { name: pvc },
      spec: {
        restic: {
          copyMethod: "Clone",
          moverPodLabels: { "app.kubernetes.io/name": "volsync-mover" },
          moverSecurityContext: securityContext(opts.securityContext).pod,
          pruneIntervalDays: 1,
          repository: name,
          retain: opts.retain ?? defaultRetain,
          storageClassName: "standard",
        },
        sourcePVC: pvc,
        trigger: { schedule: opts.schedule ?? defaultSchedule },
      },
    },
  };
};
