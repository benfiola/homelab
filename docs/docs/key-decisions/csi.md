---
title: Container Storage Interface (CSI)
---

I use **Linstor** (via the Piraeus Datastore operator) for persistent storage. It provides the flexibility to use LVM block devices, supports snapshots and backups, and integrates cleanly with Kubernetes. Here's how I arrived at this choice.

## Decision Criteria

When evaluating CSI solutions, I prioritized:

- **Flexibility with block devices**: Support for LVM and logical volumes, not requiring entire block devices to be dedicated
- **Operational simplicity**: Easy to deploy, understand, and troubleshoot
- **Backup and recovery**: Native snapshot support for point-in-time backups

## The Journey

### Initial Path: Ceph + Rook

Ceph + Rook are popular choices for distributed block storage. However, they have a fundamental limitation: they require entire block devices to be dedicated to the cluster. My infrastructure uses SSDs as system partitions on several nodes, so I needed a solution that could work with slices of a block device rather than consuming entire devices.

This architectural mismatch disqualified Ceph + Rook immediately.

### Detour: Longhorn

Longhorn appealed because it didn't require full block device dedication—it could work with partial allocations, which aligned with my infrastructure.

However, two problems emerged during deployment:

**Difficult troubleshooting**: The consensus in the community is that Longhorn failures are painfully difficult to debug. When issues arise, there's limited observability into what's actually failing.

**Resource constraints**: Longhorn's controller generates workloads on nodes, but there's no way to configure resource requests and limits for these workloads. Feature requests for this capability haven't been addressed in years. Without the ability to constrain resource utilization, Longhorn workloads could starve other applications on the cluster.

The combination of opaque failures and uncontrollable resource consumption made Longhorn unsuitable.

### Final Choice: Linstor (Piraeus Datastore)

I discovered Linstor while researching CSI options. Someone in the community mentioned it was mature, had lean requirements, and was straightforward to support. Linstor is a distributed storage system, and Piraeus Datastore is the Kubernetes operator that deploys it.

What makes Linstor compelling:

**Kubernetes-native state**: Piraeus Datastore stores Linstor's internal state in Kubernetes resources, so you can query and manage the storage cluster via standard Kubernetes APIs.

**LVM support**: Critically, Linstor supports LVM block devices and LVM thin pools. This means I can allocate logical volumes from my SSDs and give them to Linstor—exactly the flexibility I needed.

**Snapshot and backup capabilities**: Linstor integrates with Kubernetes' snapshot API and external-snapshotter. Combined with Volsync (a PVC backup/restore tool), I can derive backups from just-in-time snapshots. This provides robust recovery options without dedicating separate infrastructure.

**Simple deployment**: Setting up both the operator and supporting custom resources was straightforward. I did create a simple [bootstrap/provisioning controller](https://github.com/benfiola/homelab-helper) that runs as an initContainer for Linstor, but otherwise everything works out of the box.

However, there are minor operational quirks worth noting:

**Limited operator customization**: The Piraeus operator deployment is effectively a default installation. Customization must be handled via Kustomize overlays rather than through operator configuration options. This works, but it's a less elegant approach than some alternatives.

**Namespace co-location**: Linstor deploys to the same namespace as the operator. While the cluster can be configured simply via CRDs, having both the operator and storage workloads in the same namespace feels slightly odd architecturally. It's not a dealbreaker, just a minor organizational quirk.

These are minor considerations that don't outweigh Linstor's benefits for this use case.

## Final Architecture

**Linstor** via Piraeus Datastore provides distributed persistent storage that's flexible, observable, and integrated with Kubernetes. Its support for LVM and snapshots, combined with simple deployment and operation, makes it the right choice for this cluster.
