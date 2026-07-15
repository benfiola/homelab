---
title: Container Storage Interface (CSI)
---

**Linstor** (via the Piraeus Datastore operator) is used for persistent storage. It supports LVM block devices, snapshots, and backups, and integrates cleanly with Kubernetes.

## Requirements

- **Flexibility with block devices**: support for LVM and logical volumes, not requiring entire block devices to be dedicated
- **Operational simplicity**: easy to deploy, understand, and troubleshoot
- **Backup and recovery**: native snapshot support for point-in-time backups

## Timeline

### 1. Ceph + Rook

A common choice for distributed block storage, but it requires entire block devices to be dedicated to the cluster. Several nodes use SSDs as system partitions, so a solution that could work with slices of a block device was needed rather than one consuming entire devices. Ruled out for this reason.

### 2. Longhorn

Longhorn didn't require full block device dedication — it could work with partial allocations, which fit the infrastructure. Two issues came up during deployment:

- **Troubleshooting**: community consensus is that Longhorn failures are difficult to debug, with limited observability into root causes.
- **Resource constraints**: Longhorn's controller generates per-node workloads with no way to configure resource requests/limits. The relevant feature requests have been open for years. Unconstrained, these workloads could starve other applications on the cluster.

Ruled out due to the combination of opaque failures and uncontrollable resource consumption.

### 3. Linstor (Piraeus Datastore)

Found while researching remaining options; had a reputation in the community for maturity, lean requirements, and straightforward support. Linstor is the distributed storage system; Piraeus Datastore is the Kubernetes operator that deploys it.

- **Kubernetes-native state**: Piraeus Datastore stores Linstor's internal state in Kubernetes resources, queryable and manageable via standard Kubernetes APIs.
- **LVM support**: Linstor supports LVM block devices and LVM thin pools, allowing logical volumes to be allocated from existing SSDs.
- **Snapshot and backup**: integrates with Kubernetes' snapshot API and external-snapshotter. Combined with Volsync (a PVC backup/restore tool), backups can be derived from just-in-time snapshots without dedicating separate infrastructure.
- **Deployment**: setting up the operator and supporting custom resources was straightforward. A small [bootstrap/provisioning controller](https://github.com/benfiola/homelab-images) runs as an initContainer for Linstor; otherwise it works out of the box.

Minor operational notes:

- The Piraeus operator deployment is effectively a default installation — customization goes through Kustomize overlays rather than operator configuration options.
- Linstor deploys to the same namespace as the operator, which is a minor organizational quirk rather than a functional issue.

## Outcome

Linstor via Piraeus Datastore provides distributed persistent storage with LVM and snapshot support, Kubernetes-native state, and straightforward deployment.
