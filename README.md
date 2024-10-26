# homelab

This repository holds the code used to provision and administrate my homelab.

## Node setup

Currently, each node is running a version of [Talos Linux](https://www.talos.dev/).

Each node should have an IP reservation, and - ideally - a DNS record mapped to the reserved IP address.
For now, each node has a DNS record following the pattern `<letter>.cluster.bulia`. Finally, a single DNS record `cluster.bulia` is created - with an IP address entry for all control plane nodes.

Raspberry Pi 4 nodes have their EEPROM updated to the latest version, and are configured to automatically boot from the ESP partition. The ESP partition has [UEFI firmware](https://github.com/pftf/RPi4) written to it. For these nodes, Talos Linux is installed onto a separate, external drive - because Talos Linux operates under the assumption that it has full control of the volume it's installed to. (NOTE: This is subject to change with Talos 1.8)

For convenience, a flash drive imaged with [Ventoy](https://www.ventoy.net/en/index.html) is recommended - particularly if you're running a mixed-architecture cluster.

Once all nodes are set up, boot each node from the USB drive. Then, run the following command to install Talos Linux:

```shell
NODE="a" ROLE="controlplane" && talosctl apply-config -n "${NODE}.cluster.bulia" --file "./talos/${ROLE}.yaml" --config-patch @"./talos/${NODE}.cluster.bulia.yaml"
```

## Updating Talos Linux

## Updating Kubernetes

## Bootstrapping

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
