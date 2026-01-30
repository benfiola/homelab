---
title: Cluster and node
---

These files define your cluster's topology and hardware configuration. They serve as a source-of-truth for:

- Dynamically generating [Talos machine configuration](https://docs.siderolabs.com/talos/v1.12/reference/configuration/v1alpha1/config)
- Building Talos images via the [Talos image factory](https://factory.talos.dev)
- Runtime operations via the `homelab` CLI
- Templates that need to understand cluster details when constructing resources

## How It Works

### Volumes and Disks

Each hardware type defines volumes that will be created on the node. Volumes are logical groupings of storage, each mapped to a block device.

Two volumes should be configured on every node:

- **`SYSTEM`** - Where Talos OS boots from.
- **`EPHEMERAL`** - Temporary storage for Talos operations.

Additional volumes can be defined for application storage requirements (e.g., persistent storage via container storage interface). Multiple volumes can share the same device, effectively partitioning that device across different uses.

### Image Configuration and Schematics

:::info Talos Image Factory and Schematics
Images are generated via the [Talos image factory](https://factory.talos.dev) using schematics. Schematics allow you to customize the base Talos OS image with system extensions, boot parameters, and hardware-specific overlays.
:::

Define schematics in your hardware configuration, then use `homelab generate-talos-images [version]` to generate install media URLs and container images from the factory. You can then reference these container images in the `image` field.

:::tip Just Getting Started?
The `image` field is required during schema validation, but you may not know its value yet. Start with `image: ""` and populate it after running `homelab generate-talos-images ...`.
:::

Schematic customizations include:

- **System extensions** - Additional kernel modules or tools (e.g., `siderolabs/drbd` for distributed block storage)
- **Overlays** - Hardware-specific configurations (e.g., Raspberry Pi boot parameters, GPU memory allocation)

### Base Talos Configuration

:::info Configuration Merging
The `homelab` CLI dynamically creates Talos machine configuration by performing merges on several 'layers' of configuration (default configuration → base talos config → node configuration).
:::

Base Talos configuration expresses settings that apply to all nodes, such as:

- CNI configuration (e.g., `cluster.network.cni.name`)
- Kernel module parameters
- Kubelet mounts and features
- Proxy settings

Node-specific settings override cluster-wide settings during generation.

### Node Enabling and Disabling

When `enabled: false`, a node is excluded from any `homelab` activity that relies upon a node list.

This is useful for temporarily taking nodes offline without removing their configuration.

## Example Configuration

### Cluster Configuration (config/cluster.yaml)

This example shows a minimal cluster configuration with a single hardware type and an assortment of settings:

```yaml
name: my-cluster
endpoint: cluster.com
kubernetes: 1.34.2

hardware:
  one-hw-config:
    image: ""
    disks:
      SYSTEM:
        device: /dev/nvme0n1
      EPHEMERAL:
        device: /dev/nvme0n1
    imageConfig:
      filename: metal-amd64.iso
      schematic:
        customization:
          systemExtensions:
            officialExtensions:
              - siderolabs/drbd

baseTalosConfig:
  cluster:
    network:
      cni:
        name: none
```

### Node Configuration (config/node-\*.yaml)

Node files define individual nodes within the cluster:

```yaml
# Control plane node
hostname: node-one.cluster.com
hardware: one-hw-config
role: controlplane

# Worker node
hostname: node-two.cluster.com
hardware: one-hw-config
role: worker
```

## Schema

### Cluster Configuration

**File**: `config/cluster.yaml`

| Field             | Type   | Required | Description                                                                     |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------------- |
| `name`            | string | ✓        | Cluster name identifier                                                         |
| `endpoint`        | string | ✓        | Kubernetes API endpoint (FQDN or IP with port, e.g., `cluster.bulia.dev`)       |
| `kubernetes`      | string | ✓        | Kubernetes version to deploy (e.g., `1.34.2`)                                   |
| `baseTalosConfig` | object | ✓        | Talos OS configuration applied cluster-wide (merged with generated node config) |
| `hardware`        | object | ✓        | Hardware type definitions by name (e.g., `rpi4`, `tc`)                          |

### Hardware Definition

**Location**: `config/cluster.yaml` → `hardware[name]`

Each hardware type (e.g., `rpi4`, `tc`) defines storage volumes and image customization for that hardware:

| Field         | Type   | Required | Description                                                                |
| ------------- | ------ | -------- | -------------------------------------------------------------------------- |
| `image`       | string | ✓        | Talos OS image URI (generated via image factory or direct image reference) |
| `disks`       | object | ✓        | Volume definitions by name (e.g., `SYSTEM`, `EPHEMERAL`, `linstor`)        |
| `imageConfig` | object | ✓        | Image factory configuration for generating customized Talos images         |

### Disk/Volume Definition

**Location**: `config/cluster.yaml` → `hardware[name].disks[name]`

Defines a volume and its storage device mapping:

| Field    | Type   | Required | Description                                                                               |
| -------- | ------ | -------- | ----------------------------------------------------------------------------------------- |
| `device` | string | ✓        | Block device path (e.g., `/dev/sda`, `/dev/nvme0n1`, `/dev/mmcblk0` for Raspberry Pi)     |
| `size`   | string |          | Volume size allocation (informational field for documentation, e.g., `200GiB`, `1600GiB`) |

### Image Configuration

**Location**: `config/cluster.yaml` → `hardware[name].imageConfig`

Specifies how Talos images are generated via the image factory:

| Field       | Type   | Required | Description                                                                |
| ----------- | ------ | -------- | -------------------------------------------------------------------------- |
| `filename`  | string | ✓        | Output filename for the generated image (e.g., `metal-amd64.iso`)          |
| `schematic` | object | ✓        | Factory schematic for image customization (see Schematic Definition below) |

### Schematic Definition

**Location**: `config/cluster.yaml` → `hardware[name].imageConfig.schematic`

Defines customizations applied to the Talos OS image:

| Field           | Type   | Required | Description                                                    |
| --------------- | ------ | -------- | -------------------------------------------------------------- |
| `customization` | object |          | Customization options (system extensions, overlays, etc.)      |
| `overlay`       | object |          | Hardware-specific overlay (e.g., SBC-specific boot parameters) |

#### Customization Subfields

| Field                                 | Type   | Required | Description                                        |
| ------------------------------------- | ------ | -------- | -------------------------------------------------- |
| `systemExtensions`                    | object |          | Official Talos extensions to include in the image  |
| `systemExtensions.officialExtensions` | array  |          | Array of extension names (e.g., `siderolabs/drbd`) |

#### Overlay Subfields

| Field     | Type   | Required | Description                                                               |
| --------- | ------ | -------- | ------------------------------------------------------------------------- |
| `image`   | string | ✓        | Overlay image reference (e.g., `siderolabs/sbc-raspberrypi`)              |
| `name`    | string | ✓        | Overlay name (e.g., `rpi_generic`)                                        |
| `options` | object | ✓        | Overlay-specific options (e.g., Raspberry Pi `configTxt` boot parameters) |

### Node Configuration

**File**: `config/node-{name}.yaml`

Defines an individual node's membership in the cluster:

| Field      | Type    | Required | Description                                                                                                                    |
| ---------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `hostname` | string  | ✓        | Hostname for the node (FQDN or short name)                                                                                     |
| `hardware` | string  | ✓        | Hardware type reference (must match a key in `config/cluster.yaml` → `hardware`)                                               |
| `role`     | string  | ✓        | Node role: `controlplane` (control plane/etcd member) or `worker` (compute workload)                                           |
| `enabled`  | boolean |          | Whether the node is enabled in cluster operations (default: `true`). Set to `false` to exclude from node listing and commands. |
