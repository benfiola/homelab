# homelab

This repository hosts the infrastructure-as-code that ultimately powers the Kubernetes cluster I'm running out of my closet.

Its goals are:

- Document set-up and maintenance tasks for this Kubernetes cluster
- Host (non-sensitive) configuration for the nodes within the cluster
- Generate kubernetes manifests from code
- (Indirectly) automate deployments of generated manifests to cluster
- Provide convenience automation around common administrative tasks

> [!WARNING]
> This code is intentionally non-extensible. However, it does offer a forkable foundation for your own infrastructure-as-code project.

## Getting started

### Pre-requisites

> [!NOTE]
> Use [VSCode](https://code.visualstudio.com/) + [devcontainers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) for a streamlined environment setup process. This project already includes the necessary devcontainer configuration.

- _make_
- [NodeJS](https://nodejs.org)

### Setup

```shell
# install cli tools
make download-tools
# install nodejs dependencies
make install-nodejs-project
# update path to expose tools and `homelab` CLI
export PATH=$(pwd)/.dev:$(pwd)/node_modules/.bin:${PATH}
# (optional): fetch sensitive configuration from cloud storage
gcloud auth application-default login
homelab env download
homelab nodes config download
```

## Apps

_Apps_ are the central concept of this project. These are defined in the [./apps](./apps) folder. The app name is inferred from the filename.

Apps can:

- Perform one-time cluster bootstrapping
- Expose custom resources that can be imported by cdk8s and used elsewhere
- Generate manifests
- Provide custom sub-commands.

Apps define which behavior they provide by registering callbacks to a provided [CliContext](./utils/CliContext.ts).

Here's a kitchen-sink example:

```typescript
// ./apps/example.ts
import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import {
  BootstrapCallback,
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";

const bootstrap: BootstrapCallback = async (app) => {
  const chart = new Chart(app, "example", { namespace: "example" });
  // ... attach cdk8s resources to `chart`
  return chart;
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "example", { namespace: "example" });
  // ... attach cdk8s resources to `chart`
  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  // obtain manifest text and write to `manifestFile`
  const manifest = "";
  await writeFile(manifestFile, manifest);
};

export default async function (context: CliContext) {
  // (optional) registers the app with the 'homelab bootstrap' command.
  context.bootstrap(bootstrap);
  // (optional) registers app-level commands with the 'homelab apps [app]' command.
  context.command((program: Command) => {
    program
      .command("custom-command")
      .description("implements a custom subcommand under 'homelab")
      .action(getCertificate);
  });
  // (optional) registers the app with the 'homelab manifests' command.
  context.manifests(manifests);
  // (optional) registers the app with the 'homelab resources' command.
  context.resources(resources);
}
```

## `homelab` CLI

The `homelab` CLI is the entry point into the automation provided by this project. You can get a high-level overview of the commands available to you by viewing the CLI help directly:

```shell
homelab --help
```

There's a handful of commands - here's an example of some of the ways it can be used:

```shell
# get sealed-secrets signing-cert
homelab apps sealed-secrets get-certificate
# bootstrap a cluster with argocd
homelab bootstrap argocd
# download env file from cloud storage
homelab env download
# generate manifests for factorio
homelab manifests factorio generate
# apply talos configuration to node 'a'
homelab nodes config apply [node]
# upload modified talos configuration to cloud storage
homelab nodes config upload
# generate cdk8s resources for volsync
homelab resources volsync generate
```

## Automated deployments

Deployments are currently automated via a [publish](.github/workflows/publish.yaml) Github workflow. This workflow runs `homelab manifests all generate` - and commits this to a [private repository](https://github.com/benfiola/homelab-manifests.git).

This workflow requires three pieces of data to operate:

> [!WARNING]
> This data _must_ be kept up-to-date or this automation will fail!

| Data                          | Description                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ENV_FILE`                    | The contents of `.env`                                                                                                      |
| `HOMELAB_MANIFESTS_GIT_TOKEN` | A token that has permissions to push commits to the [private repository](https://github.com/benfiola/homelab-manifests.git) |
| `SEALED_SECRETS_CERT`         | The public certificate used to sign sealed secrets for the cluster. (`homelab apps sealed-secrets get-certificate`)         |

This information is currently hosted as secrets in the _publish_ Github environment attached to the workflow.

## Maintenance

### Initial Cluster Setup

Generate secret material used to initialize the talos cluster

```shell
homelab talos generate-secrets
```

Use these secrets to generate a local talosconfig file to communicate with the cluster

```shell
homelab talos generate-talosconfig
```

### Initial Node Setup

> [!IMPORTANT]
> Raspberry PI machines need to be set up with [UEFI firmware](https://github.com/pftf/RPi4) before proceeding. Once done, ensure that the 3GB RAM limit is disabled within the UEFI menu.

> [!NOTE]
> The cluster endpoint is `cluster.bulia.dev` - whose DNS A points to _all_ controlplane worker node IPs. Each node has a domain `node-[name].cluster.bulia.dev` as an additional DNS A record.

Each node is running [Talos Linux](https://www.talos.dev/) - a Linux distribution designed purely to run Kubernetes.

To install Talos Linux onto a node, prepare USB installation media with [Ventoy](https://www.ventoy.net/en/index.html) and copy the appropriate `metal-arm64.iso` and `metal-amd64.iso` images onto the USB drive. You can find these images on the Talos Linux [releases](https://github.com/siderolabs/talos/releases) page.

Boot into the installation media on each node - which then launches Talos Linux in maintenance mode. This allows you to 'apply configuration' to these machines - which triggers installation/repair processes. Use the `homelab` CLI to apply configuration to the nodes. This starts the installation process.

> [!NOTE]
> The node configuration can be found at `./talos/node-[name].cluster.bulia.dev.yaml`. Take note of the `ROLE` field. These configuration files are overlaid on top of `./talos/[role].yaml` to produce the full configuration.

```shell
homelab talos apply [name] --insecure
```

Once complete, the nodes should reboot automatically - booting off of the partition that Talos Linux was installed to.

> [!IMPORTANT]
> Raspberry PI machines do not automatically reboot after installation. Manually power cycle them.

### Initial Cluster Setup

> [!IMPORTANT]
> You must specify a control plane node when bootstrapping the cluster

When all nodes have been prepared, start Kubernetes by bootstrapping the cluster:

```shell
homelab talos bootstrap a
```

This starts Kubernetes - and all nodes will then join the cluster. You can then obtain the administrative kubeconfig for the cluster using the `homelab` CLI:

```shell
homelab talos kubeconfig
```

#### Piraeus-specific setup

In order for Piraeus to operate correctly, an LVM thin pool needs to be configured on the node after it joints the cluster.

Run the following command to open a privileged shell on the node:

```shell
homelab nodes shell [node]
```

Then run the following commands to provision an LVM thin pool:

```shell
parted <block-device>
(parted) print free
(parted) mkpart primary <free-space-start> 100%
(parted) set <partition-number> lvm on
(parted) quit
pvcreate <partition>
vgcreate vg <partition>
lvcreate -L <pool-size> -T vg/piraeus
```

Once this is complete, you can then use the `homelab` CLI to bootstrap the cluster with required applications:

```shell
# provides the cluster CNI
homelab bootstrap cilium
# facilitates automated deployments
homelab bootstrap argocd
# provides basic secrets management
homelab bootstrap sealed-secrets
```

> [!IMPORTANT]
> Once sealed-secrets is bootstrapped, obtain its certificate via `homelab apps sealed-secrets get-certificate`.
> Update the `homelab` Github workflow secret `SEALED_SECRETS_CERT` with this value.
> Re-run the publish job to re-encrypt SealedSecret resources with this new cert.

Once these workoads are all running, hand over deployments to _ArgoCD_ by running the following command:

```shell
homelab bootstrap argocd-app-of-apps
```

ArgoCD should begin deploying all manifests and will _eventually_ reconcile them.

### Node Updates

#### Updating configuration

Modifications made to the:

- `./talos/node-*.cluster.bulia.dev.yaml`
- `./talos/node.yaml`
- `./talos/system-disk.yaml`

files need to be applied to node for the changes to take effect. Use the `homelab` CLI to do this:

```shell
homelab talos apply [node]
```

#### Upgrade Talos Linux

To update the Talos Linux version on all nodes, navigate to Talos' [image factory](https://factory.talos.dev/) to produce a Talos Linux installer image for the desired version _with the following system extensions_:

- drbd
- i915

Once an image is produced, you should have an image that looks like `factory.talos.dev/installer/[hash]:v[talos-version]`. Update the `.machine.env.IMAGE` field within the `./talos/node.yaml` file with this value.

Then, run the following command to upgrade the nodes:

```shell
homelab talos upgrade
```

#### Upgrade Kubernetes

Update the `./talos/node.yaml` file and set the `.machine.env.K8S` field to the desired Kubernetes version.

Then, run the following command to upgrade the nodes:

> [!NOTE]
> Even though the above command targets a single node - _all_ nodes will be updated.

```shell
homelab talos upgrade-k8s [node]
```
