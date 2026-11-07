export class VolsyncAuth extends VaultAuth {
  constructor(construct: Construct) {
    super(construct, {
      role: "volsync-mover",
      serviceAccount: "volsync-mover-vault-secrets-operator",
    });
  }
}

interface VolsyncBackupOpts {
  securityContext?: GetSecurityContextOpts;
}

export class VolsyncBackup extends Construct {
  constructor(
    construct: Construct,
    auth: VolsyncAuth,
    pvc: string,
    opts: VolsyncBackupOpts = {},
  ) {
    const chart = getChart(construct);
    const id = `${chart.node.id}-volsync-backup-${pvc}`;
    super(construct, id);

    const namespace = chart.namespace;
    const vaultSecret = new VaultDynamicSecret(
      this,
      auth,
      (secretRef) => ({
        B2_ACCOUNT_ID: secretRef("backblaze-application-key-id"),
        B2_ACCOUNT_KEY: secretRef("backblaze-application-key"),
        RESTIC_REPOSITORY: `b2:homelab-volsync-697438:/${namespace}/${pvc}`,
        RESTIC_PASSWORD: secretRef("restic-password"),
      }),
      {
        name: `volsync-mover-${pvc}`,
        path: "volsync",
      },
    );

    const securityContext = getSecurityContext(opts.securityContext);

    new ReplicationSource(this, `replications-source-${pvc}`, {
      metadata: { name: pvc },
      spec: {
        restic: {
          copyMethod: "Clone" as any,
          moverPodLabels: {
            "app.kubernetes.io/name": "volsync-mover",
          },
          moverSecurityContext: securityContext.pod,
          pruneIntervalDays: 1,
          repository: vaultSecret.name,
          retain: {
            daily: 7,
            within: "1d",
          },
          storageClassName: "standard",
        },
        sourcePvc: pvc,
        trigger: {
          schedule: "0 12 * * *",
        },
      },
    });
  }
}