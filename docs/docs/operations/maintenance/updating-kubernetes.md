---
title: Updating Kubernetes
---

Upgrade the Kubernetes version across the cluster.

## Prerequisites

- Update the `kubernetes` field in `config/cluster.yaml` to the desired version
- Reference [cluster configuration](/configuration/cluster-and-node.md) for details

## Perform update

```bash
homelab talosctl -n [control-plane-node] upgrade-k8s
```
