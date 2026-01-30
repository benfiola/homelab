---
title: Adding a Node
sidebar_position: 2
---

This guide walks through adding a node to an active cluster.

## Prerequisites

Before starting, ensure:

- The node has been [prepared](/operations/maintenance/preparing-a-node.md)
- [Node configuration](/configuration/cluster-and-node.md) has been defined

## Apply system configuration

:::warning
The `--insecure` flag only works the first time configuration is applied to a node.
:::

Apply system configuration to the node:

```bash
homelab talosctl apply-system-config [node] --insecure
```

## Verify the node joins the cluster

The node should join the cluster and be visible in both the Talos dashboard and Kubernetes.

```bash
homelab talosctl dashboard
kubectl get nodes
```
