---
title: Updating Cluster Configuration
sidebar_position: 3
---

Apply changes to cluster and node configuration across enabled nodes.

:::warning Updating Kubernetes or Talos Linux versions?
While sharing a common configuration, there are different processes to update Kubernetes and Talos Linux versions themselves.

- [Updating Kubernetes](/operations/maintenance/updating-kubernetes.md)
- [Updating Talos Linux](/operations/maintenance/updating-talos-linux.md)

:::

## Prerequisites

- Ensure [cluster and node configuration](/configuration/cluster-and-node.md) reflects the desired changes

## Apply to all nodes

```bash
homelab apply-system-config
```

## Apply to selected nodes

```bash
homelab apply-system-config --nodes node-1,node-2
```
