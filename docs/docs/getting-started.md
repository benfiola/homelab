---
title: Getting Started
sidebar_position: 2
---

This guide walks through the initial setup process for the cluster. Each step builds on the previous one.

## 1. Prepare all nodes

[Prepare nodes](/operations/maintenance/preparing-a-node.md) for use with the cluster.

## 2. Initialize configuration and secrets

:::info First time setup?
If you're starting from scratch, you'll need to make sure that the following configuration files are in place.

- [Cluster and nodes](/configuration/cluster-and-node.md)
- [Flux](/configuration/flux.md)
- [Storage](/configuration/storage.md)

Then, you'll need to generate Talos secrets:

```bash
homelab talosctl gen secrets --output-file ./config/secrets-talos.yaml
```

Skip ahead if you already have secrets.
:::

If secrets exist but aren't local, pull them:

```bash
homelab pull-secrets
```

Generate client configuration:

```bash
homelab generate-client-config
homelab talosctl -n [control-plane-node] kubeconfig
```

## 3. Apply system configuration

:::info Node Names
Node names depend on your local configurations and are extracted from configuration file names. A configuration file `./config/node-abc-def-1.yaml` identifies a node `abc-def-1`.

Replace `node-1 node-2` below with a space-separated list of _your_ node names.
:::

Apply system configuration for every node in the cluster.

```bash
for n in node-1 node-2; do
  homelab apply-system-config --insecure "${n}";
done;
```

## 4. Start the cluster

:::info Waits for CNI
This command will hang until a CNI is deployed. You can run this in a separate terminal and proceed to the next step while it completes.
:::

To bootstrap the control plane:

```bash
homelab talosctl -n [control-plane-node] bootstrap
```

## 5. Bootstrap the cluster

Complete the full cluster bootstrap. This deploys all network policies, a CNI, a gitops provider and a secrets store.

```bash
homelab bootstrap
```
