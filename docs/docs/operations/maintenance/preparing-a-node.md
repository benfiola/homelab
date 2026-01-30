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

### Raspberry PI 4 (`rpi4`)

#### Update the EEPROM (one time only)

:::info
This step only needs to be performed once per Raspberry Pi. If you've already updated the EEPROM, skip to [Image the SD card](#image-the-sd-card).
:::

1. Connect the SD card to your computer
2. Download the [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
3. Launch Raspberry Pi Imager and select:
   - `Misc utility images` → `Bootloader` → `USB Boot`
4. Write to the SD card device
5. Insert the SD card into the Raspberry Pi
6. Wait for the status LED to blink green (indicates successful EEPROM update)

#### Image the SD card

1. Connect the SD card to your computer
2. Identify the SD card block device using `lsblk`
3. Write the raw image:
   ```bash
   sudo dd if=[raw-image] of=/dev/[sd-card] bs=4M
   ```
4. Insert the SD card into the Raspberry Pi
5. Power on the Raspberry Pi
6. Wait for Talos Linux to boot

### Thinkcentre (`tc`)

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
