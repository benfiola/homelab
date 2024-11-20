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
- [Yarn](https://yarnpkg.com/) package manager
- Sensitive configuration:
  - _.env_
  - _talos/config_
  - _talos/controlplane.yaml_
  - _talos/worker.yaml_

### Setup

```shell
# install cli tools
make install-tools
# install nodejs dependencies
yarn install
# update path
export PATH=$(pwd)/.dev:$(pwd)/node_modules/.bin:${PATH}
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
# generate manifests for factorio
homelab manifests factorio generate
# apply talos configuration to node 'a'
homelab nodes apply-config a
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

### Initial Node Setup

> [!IMPORTANT]
> Raspberry PI machines need to be set up with [UEFI firmware](https://github.com/pftf/RPi4) before proceeding. Once done, ensure that the 3GB RAM limit is disabled within the UEFI menu.

> [!NOTE]
> The cluster endpoint is `cluster.bulia` - whose DNS A points to _all_ controlplane worker node IPs. Each node has a domain `node-[name].cluster.bulia` as an additional DNS A record.

Each node is running [Talos Linux](https://www.talos.dev/) - a Linux distribution designed purely to run Kubernetes.

To install Talos Linux onto a node, prepare USB installation media with [Ventoy](https://www.ventoy.net/en/index.html) and copy the appropriate `metal-arm64.iso` and `metal-amd64.iso` images onto the USB drive. You can find these images on the Talos Linux [releases](https://github.com/siderolabs/talos/releases) page.

Boot into the installation media on each node - which then launches Talos Linux in maintenance mode. This allows you to 'apply configuration' to these machines - which triggers installation/repair processes. Use the `homelab` CLI to apply configuration to the nodes. This starts the installation process.

> [!NOTE]
> The node configuration can be found at `./talos/node-[name].cluster.bulia.yaml`. Take note of the `ROLE` field. These configuration files are overlaid on top of `./talos/[role].yaml` to produce the full configuration.

```shell
homelab nodes apply-config [name] --insecure
```

Once complete, the nodes should reboot automatically - booting off of the partition that Talos Linux was installed to.

> [!IMPORTANT]
> Raspberry PI machines do not automatically reboot after installation. Manually power cycle them.

### Initial Cluster Setup

When all nodes have been prepared, start Kubernetes by bootstrapping the cluster:

```shell
talosctl bootstrap --nodes node-[name].cluster.bulia
```

This starts Kubernetes - and all nodes will then join the cluster. You can then obtain the administrative kubeconfig from the cluster through `talosctl`:

```shell
talosctl --nodes node-[name].cluster.bulia kubeconfig
```

You can then use the `homelab` CLI to bootstrap the cluster with required applications:

```shell
# provides the cluster CNI
homelab bootstrap cilium
# facilitates automated deployments
homelab bootstrap argocd
# provides basic secrets management
homelab bootstrap sealed-secrets
```

Once these workoads are all running, hand over deployments to _ArgoCD_ by running the following command:

```shell
homelab bootstrap argocd-app-of-apps
```

ArgoCD should begin deploying all manifests and will _eventually_ reconcile them.

### Node Updates

#### Updating configuration

Modifications made to either the `./talos/[role].yaml` or `./talos/node-[node].cluster.bulia.yaml` files need to be applied to the node for the changes to take effect. Use the `homelab` CLI to do this:

```shell
homelab nodes [name] apply-config
```

#### Upgrade Talos Linux

To update the Talos Linux version on all nodes, navigate to Talos' [image factory](https://factory.talos.dev/) to produce a Talos Linux installer image for the desired version _with the following system extensions_:

- drbd

Once an image is produced, you should have an image that looks like `factory.talos.dev/installer/[hash]:v[talos-version]`. Update the `.machine.install.image` field within each `./talos/[role].yaml` file with this value and then upload these files to cloud storage.

Then, run the following command to upgrade the nodes:

```shell
talosctl upgrade --image <image>
```

#### Upgrade Kubernetes

Update the `./talos/[role].yaml` files - replacing the `kubelet`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` image tags with the desired Kubernetes version. Upload these files to cloud storage.

Then, run the following command to upgrade the nodes:

> [!NOTE]
> Even though the above command targets a single node - _all_ nodes will be updated.

```shell
talosctl --nodes node-[node].cluster.bulia upgrade-k8s --to [version]
```
