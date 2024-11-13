# homelab

This repository holds the code used to provision and administrate my homelab.

## Prerequisites

This repository depends on the following sensitive files that are not stored in the repo:

- `.env`
- `talos/config`
- `talos/controlplane.yaml`
- `talos/worker.yaml`

Fetch these files and install them in the correct locations.

Optionally, open this project as a devcontainer within VSCode (as this project was designed with VSCode and devcontainers).

## Setup Nodes

Currently, each node is running a version of [Talos Linux](https://www.talos.dev/).

Each node should have an IP reservation, and - ideally - a DNS record mapped to the reserved IP address.
For now, each node has a DNS record following the pattern `<letter>.cluster.bulia`. Finally, a single DNS record `cluster.bulia` is created - with an IP address entry for all control plane nodes.

Raspberry Pi 4 nodes have their EEPROM updated to the latest version, and are configured to automatically boot from the ESP partition. The ESP partition has [UEFI firmware](https://github.com/pftf/RPi4) written to it. For these nodes, Talos Linux is installed onto a separate, external drive - because Talos Linux operates under the assumption that it has full control of the volume it's installed to. (NOTE: This is subject to change with Talos 1.8)

For convenience, a flash drive imaged with [Ventoy](https://www.ventoy.net/en/index.html) is recommended - particularly if you're running a mixed-architecture cluster.

Once all nodes are set up, boot each node from the USB drive. Then, run the following command to install Talos Linux on each node:

```shell
NODE="a" ROLE="controlplane" && talosctl apply-config -n "node-${NODE}.cluster.bulia" --file "./talos/${ROLE}.yaml" --config-patch @"./talos/node-${NODE}.cluster.bulia.yaml"
```

Here's a table mapping nodes to roles:

| Node                 | Role         |
| -------------------- | ------------ |
| node-a.cluster.bulia | controlplane |
| node-b.cluster.bulia | controlplane |
| node-c.cluster.bulia | controlplane |
| node-d.cluster.bulia | worker       |
| node-e.cluster.bulia | worker       |
| node-f.cluster.bulia | worker       |

Finally, once all nodes are set up - bootstrap the cluster:

```shell
talosctl bootstrap --nodes node-a.cluster.bulia --endpoints cluster.bulia --talosconfig=./talos/config
```

NOTE: Only a single controlplane node needs to be supplied to the bootstrap command.

Finally, update your local kubeconfig to access the cluster:

```shell
talosctl --nodes node-a.cluster.bulia kubeconfig
```

## Update Talos Linux

To update the Talos Linux version on all nodes, navigate to Talos' [image factory](https://www.talos.dev/v1.8/learn-more/image-factory/) and generate an image for the desired Talos Linux version and additionally contains the following extensions:

- iscsi-tools
- util-linux-tools

Once an image is produced, you should have an image tag that looks like `factory.talos.dev/installer/613e1592b2da41ae5e265e8789429f22e121aab91cb4deb6bc3c0b6262961245:v1.8.1`.

Ensure that the [controlplane](./talos/controlplane.yaml) and [worker](./talos/worker.yaml) configurations refer to this new image via the `.install.image` key.

Then, run the following command to upgrade the nodes:

```shell
talosctl upgrade --image <image>
```

## Updating Kubernetes

To upgrade the Kubernetes version on all nodes, ensure that the [control](./talos/controlplane.yaml) and [worker](./talos/worker.yaml) configurations reference the new kubernetes version. This requires systematically updating the `kubelet`, `kube-apiserver`, `kube-controller-manager` and `kube-scheduler` images such that their tags all reflect the new Kubernetes version. For example, updating Kubernetes from version `1.29.1` to `1.30.5` would require changing the following images

- `ghcr.io/siderolabs/kubelet:v1.29.1` -> `ghcr.io/siderolabs/kubelet:v1.30.5`
- `registry.k8s.io/kube-apiserver:v1.29.1` -> `registry.k8s.io/kube-apiserver:v1.30.5`
- `registry.k8s.io/kube-controller-manager:v1.29.1` -> `registry.k8s.io/kube-controller-manager:v1.30.5`
- `registry.k8s.io/kube-scheduler:v1.29.1` -> `registry.k8s.io/kube-scheduler:v1.30.5`

Then, run the following command to upgrade the nodes:

```shell
talosctl --nodes <controlplane node> upgrade-k8s --to <version>
```

NOTE: Only a single controlplane node needs to be provided above. The update will propagate to all other controlplane and worker nodes.

## Bootstrapping applications

The end-goal is to deploy ArgoCD and have _that_ manage long-term deployments of cluster applications. However,
an initial set of resources need to be deployed to the cluster so that ArgoCD can be deployed. This general process is called _bootstrapping_.

First, deploy all resources needed to bootstrap the cluster. Ensure each application is running _before_
attempting to deploy the next one.

```shell
# deploy cilium (this is the cni - it's a prerequisite for *all* other deployments)
yarn run cli bootstrap cilium
# deploy argocd
yarn run cli bootstrap argocd
# deploy sealed-secrets (this is used by most regularly deployed manifests)
yarn run cli bootstrap sealed-secrets
```

Confirm that all deployed workloads are running.

Once all deployed workloads are running, generate all manifests. (**NOTE**: Some manifests depend on _sealed-secrets_ to be deployed - this is why bootstrapping is a prerequisite for manifests generation).

```shell
yarn run cli manifests all
```

Commit and push these manifests (as ArgoCD will sync against the remote repository):

```shell
git add -A
git commit -m "initial commit"
git push origin
```

Finally, manually deploy the argocd app-of-apps:

```shell
yarn run cli bootstrap argocd-app-of-apps
```

Optionally, set the admin password for argocd to a known value:

```shell
yarn run cli argocd set-admin-password
```

## TODO

- Revisit utilizing Mayastor once Talos 1.8 is released. (This [feature](https://github.com/siderolabs/talos/issues/8367) might enable allocating a system partition that can be given to Mayastor without fear of Talos erasing it during administrative operations)
- Continue to update README to reflect current deployment practice
