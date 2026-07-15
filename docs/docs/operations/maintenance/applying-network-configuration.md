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

1. Copy the rendered script to the router:

   ```bash
   scp network-config/router.rsc [user]@[router-address]:
   ```

2. SSH into the router and reset its configuration, applying the script immediately on reboot:

   ```
   /system/reset-configuration no-defaults=yes run-after-reset=router.rsc
   ```

3. Once the router is back online, log in and set the router user password(s) to match `router.users` in `config/secrets-network.yaml`.

## SwitchOS

1. Factory-reset the switch using one of:

   - Hold the reset button while powering the switch on, keeping it held until it boots to factory defaults
   - If the switch's web UI is already reachable, trigger a reset from there

2. Once the switch is back online at its default address with default credentials, apply the rendered configuration:

   ```bash
   homelab apply-swos network-config/switch.core.yaml --address [switch-address]
   ```

   :::tip
   Pass `--dry-run` to preview changes before writing them. If credentials differ from the SwOS defaults (`admin` with no password), pass `--username` and `--password`.
   :::

## OpenWrt

1. SSH into the access point and reset it to factory defaults:

   ```bash
   firstboot
   ```

   The device reboots into a default, unconfigured state.

2. Once back online, copy the rendered script onto it:

   ```bash
   scp network-config/ap.[name].sh root@[ap-address]:
   ```

3. SSH into the access point and run the script:

   ```bash
   sh ap.[name].sh
   ```

4. Navigate to the device's web UI and set the admin password.
