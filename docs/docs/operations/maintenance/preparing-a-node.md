---
title: Preparing a Node
sidebar_position: 1
---

This guide walks through preparing a physical node for cluster deployment.

## Prerequisites

Before starting, ensure:

- The [cluster configuration](/configuration/cluster-and-node.md) includes a hardware definition for your node's hardware type
- You have the appropriate raw Talos image for your node

To generate Talos images:

```bash
homelab generate-talos-images [version]
```

## Imaging the node

Follow the instructions for your hardware type below.

### Thinkcentre (`tc`) and Razer Blade (`rb`)

:::tip Ventoy
Consider formatting a USB drive with [Ventoy](https://www.ventoy.net/en/index.html) to boot multiple ISO images from a single device.
:::

1. Connect the USB drive to your computer
2. Either copy the raw image to Ventoy or write the ISO directly to the drive
3. Insert the USB drive into the Thinkcentre
4. Reboot the machine and select the USB drive as the boot device
5. Wait for Talos Linux to boot

## Configure networking

At this point, the node should have acquired an IP address via DHCP.

:::tip DHCP and DNS
It's recommended to create a static DHCP reservation for this node and add a corresponding DNS A record.

If this is a control plane node, also add its DNS record to the A record for the cluster endpoint.
:::

## Verify boot state

Once booted, the node should be in `maintenance` mode.

Connect an HDMI cable to the node to view the Talos dashboard. The `Stage` field should read `Maintenance`.

:::danger Node not in maintenance mode?
If the node is not in maintenance mode, refer to [Resetting a Node](/operations/maintenance/resetting-a-node.md).
:::
