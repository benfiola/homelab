---
title: Applying Network Configuration
---

Apply generated configuration to networking devices. Because these devices don't support declarative configuration management the way the cluster does, the general workflow is to reset a device to a known (factory-default) state and then apply configuration from scratch, rather than attempt to reconcile in-place changes.

## Prerequisites

- Ensure the [networking configuration](/configuration/networking.md) reflects the desired changes
- Generate rendered device configuration into `network-config/`:

  ```bash
  homelab generate-network-config
  ```

## RouterOS

1. Copy the rendered script to the device:

   ```bash
   scp network-config/[script].rsc admin@[router-address]:/script.rsc:
   ```

2. SSH into the router and reset its configuration, applying the script immediately on reboot:

   ```
   /system/reset-configuration no-defaults=yes run-after-reset=script.rsc
   ```

3. Once the router is back online, log in as `admin` and set the router password.

## SwitchOS

1. Factory-reset the switch using one of:
   - Hold the reset button while powering the switch on, keeping it held until it boots to factory defaults
   - If the switch's web UI is already reachable, trigger a reset from there

   :::tip
   After the reset, connect directly to one of the switch's ports, then manually configure your network interface with a static IP of `192.168.1.2`, subnet `255.255.255.0`, and gateway/DNS server `192.168.1.1`. The switch should then be reachable at `admin@192.168.1.1`.
   :::

2. Once the switch is back online at its default address (`192.168.1.1`) with default credentials (`admin`, no password), apply the rendered configuration:

   ```bash
   homelab apply-swos network-config/switch.core.yaml --address [switch-address]
   ```

   :::tip
   Pass `--dry-run` to preview changes before writing them. If credentials differ from the SwOS defaults (`admin` with no password), pass `--username` and `--password`.
   :::

## OpenWrt

1. SSH into the access point and reset it to factory defaults:

   ```bash
   firstboot && reboot
   ```

   The device reboots into a default, unconfigured state.

   :::tip
   After the reset, connect directly to one of the access point's LAN ports. It will be reachable at `root@192.168.1.1` with no password.
   :::

2. Once back online, copy the rendered script onto it:

   ```bash
   scp -O network-config/ap.[name].sh root@[ap-address]:
   ```

   :::tip
   The `-O` flag forces the legacy SCP protocol, which copies over SSH directly. OpenWrt devices don't ship with `sftp-server`, so a plain `scp` (which defaults to SFTP) fails.
   :::

3. SSH into the access point and run the script:

   ```bash
   sh ap.[name].sh
   ```

   :::tip
   After applying the configuration, you'll likely need to re-connect the device via it's WAN 1 port.
   :::

4. Navigate to the device's web UI and set the admin password.

5. Reboot the device
