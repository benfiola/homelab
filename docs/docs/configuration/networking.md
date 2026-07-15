---
title: Networking
---

Configuration for networking devices (routers, switches, access points, VPN peers, etc.) is generated from a template system, decoupling device-specific configuration syntax from secret and variable substitution.

## How It Works

`config/network.yaml` declares a list of `outputs`. Each output pairs a template file with a rendered destination file, and optionally supplies `inputs` — arbitrary key/value data scoped to that single output. This allows the same template to be reused multiple times with different inputs (e.g. rendering the same access point template once per physical device, each with a different hostname).

Templates are plain text files — RouterOS scripts, shell scripts, YAML, or anything else a target device accepts — containing `${...}` placeholders evaluated as JavaScript template literals. Two objects are available inside a template:

- `secrets` — values loaded from `config/secrets-network.yaml`, available to every template
- `inputs` — the per-output `inputs` map defined for that template in `network.yaml`

Accessing a field that isn't defined on `secrets` or `inputs` raises an error at render time instead of silently emitting `undefined`, which catches typos or missing values early.

`network.yaml` itself is rendered the same way before being parsed, with `secrets` available (but not `inputs`, since output-level inputs aren't known until the outputs are parsed). This lets secret values be composed directly into an output's `inputs`, not just into the templates they feed.

Running `homelab generate-network-config` renders every configured output into the `network-config/` directory. Pass `--filter <file>...` to regenerate a subset of outputs by their destination file name.

## Configuration

**File**: `config/network.yaml`

| Field                | Type   | Required | Description                                                             |
| --------------------- | ------ | -------- | ------------------------------------------------------------------------ |
| `apiVersion`          | string | ✓        | Must be `v1alpha1`                                                       |
| `kind`                | string | ✓        | Must be `HomelabNetworkConfig`                                           |
| `outputs`             | array  | ✓        | List of template/file pairs to render                                   |
| `outputs[].file`      | string | ✓        | Destination file name, written under the output directory               |
| `outputs[].template`  | string | ✓        | Template file path, relative to `config/`                               |
| `outputs[].inputs`    | object | ✗        | Key/value data available to the template as `inputs`                    |

## Secrets

**File**: `config/secrets-network.yaml`

Secret values referenced by templates via `secrets`.

| Field                  | Type   | Required | Description                                                  |
| ----------------------- | ------ | -------- | -------------------------------------------------------------- |
| `router.users`          | object | ✓        | Router user names mapped to passwords                        |
| `wifi`                  | object | ✓        | Wi-Fi network names mapped to pre-shared keys                |
| `wireguard.interfaces`  | object | ✓        | WireGuard interface names mapped to `{ public, private }` key pairs |
| `wireguard.devices`     | object | ✓        | Device names, each mapping interface names to a `{ public, private }` key pair for that device's peer |
