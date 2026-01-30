---
title: Updating Talos Linux
---

Upgrade the Talos Linux version for nodes within the cluster.

## Prerequisites

:::tip Which Talos Linux image?
Use `homelab generate-talos-images` to generate Talos Linux images for your configuration.
:::

- Update the `image` field in `config/cluster.yaml` _for each hardware type_ to reference the intended Talos Linux image
- Reference [cluster configuration](/configuration/cluster-and-node.md) for details

## Upgrade all nodes

```bash
homelab upgrade-talos-linux
```

## Upgrade selected nodes

```bash
homelab apply-system-config --nodes node-1,node-2
```
