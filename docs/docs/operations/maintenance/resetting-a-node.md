---
title: Resetting a Node
---

Resetting a node removes all data and configuration - returning it to a pre-initialized state.

:::caution Graceful reset
By default, Talos will attempt to cordon and drain the node prior to the node reset. This will not work if all control-plane nodes are being reset. Use the `--graceful=false` option in these situations.
:::

## Reset nodes

```bash
homelab talosctl -n node-1,node-2 reset --reboot --system-labels-to-wipe=EPHEMERAL,STATE
```

Once reset, refer to [Adding a Node](/operations/maintenance/adding-a-node.md) to re-initialize the node back into the cluster.
