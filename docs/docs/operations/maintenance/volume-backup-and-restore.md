---
title: Volume Backups and Restores
---

Manage volume backups and restores for cluster deployments.

## Backups

[volsync](https://volsync.readthedocs.io/en/stable/) automates scheduled volume backups to cloud storage. Apps can include the `ReplicationSource` resource to enable this functionality.

:::tip Manual backups
See [volsync documentation](https://volsync.readthedocs.io/en/stable/) for ad-hoc backup triggers.
:::

## Restores

Use the [homelab-helper](https://benfiola.github.io/homelab-helper) project to perform volume restores by annotating the `PersistentVolumeClaim`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  annotations:
    pvc-restore.homelab-helper.benfiola.com/backup: ""
  name: sample
  namespace: sample
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: default
```

The annotation value controls the restore source:

- Empty string (`""`) - restore from the latest snapshot
- Number - restore from N snapshots ago (e.g., `3` restores from three snapshots ago)
- RFC3339 timestring - restore from a snapshot at the specified time
