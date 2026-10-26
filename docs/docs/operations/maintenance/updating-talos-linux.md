---
title: Updating Talos Linux
---

Upgrade the Talos Linux version for nodes within the cluster.

## Prerequisites

:::tip Which Talos Linux image?
Use `homelab generate-talos-images [version]` to generate Talos Linux images for your configuration. Pass the version without a leading `v` (e.g. `1.14.4`).
:::

- Update the `image` field in `config/cluster.yaml` _for each hardware type_ to reference the intended Talos Linux image
- Reference [cluster configuration](/configuration/cluster-and-node.md) for details

## Upgrade nodes

:::danger Upgrade one node at a time
Some workloads require quorum and cannot tolerate every node going down in a batch. Never upgrade multiple nodes in parallel (e.g. `--nodes=a,b,c`, or looping over nodes without waiting).

Cancelling the command (Ctrl+C) does **not** cancel the upgrade - it keeps running on the node.
:::

Upgrade each node in turn, starting with the control plane:

```bash
homelab talosctl -n [node] upgrade --wait
```

The image for the node's hardware type is read from `config/cluster.yaml`.

After each upgrade, ensure quorum has been regained before upgrading the next node.

## Applying configuration

`homelab apply-system-config` applies machine and volume configuration. It does **not** upgrade Talos Linux.
