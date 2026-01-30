---
title: Security
---

This document outlines the security model for the homelab, which employs a layered approach: network segmentation via firewalling at the router, pod-level policies within the cluster, and a hardened host OS.

## Overview

Security is enforced across three layers:

1. **Router firewall** - Controls inter-VLAN traffic and public ingress based on network segmentation
2. **In-cluster policies** - Network policies and host-level firewalling restrict pod-to-pod and pod-to-host communication
3. **Host OS** - Talos Linux provides a minimal attack surface with reduced binary footprint

This defense-in-depth approach ensures that even if one layer is compromised, others remain to protect the cluster.

## Router Firewall

The network is split into VLANs as described in [Networking](./networking.md). The homelab occupies the `Infrastructure` VLAN, with access controlled via firewall rules:

- **Trusted VLAN** → Full access to Infrastructure VLAN
- **General VLAN** → Access restricted to matched Gateway resources only
- **Public traffic** → Ingress to cluster gateways only; traffic is DNAT'd to appropriate ingress points

### Rule Management

Firewall rules are kept in sync by a helper controller defined in the companion [homelab-helper](https://github.com/benfiola/homelab-helper) repository. This controller watches the cluster state and automatically updates router firewall rules, ensuring they remain synchronized with their matched Gateway resources.

The separation into a dedicated helper controller keeps this operational concern decoupled from the main infrastructure project.

## In-Cluster Policies

Once traffic reaches the cluster, further segmentation occurs via network policies:

### Pod-to-Pod Communication

Network policies are manually defined by observing actual traffic flows, then encoding those observations as policies. This approach ensures policies reflect real application requirements rather than theoretical assumptions.

:::info Network Policy Development
For guidance on establishing network policies through traffic observation, see [Network Policies - Observing Traffic](/operations/troubleshooting/network-policies.md).
:::

### Host-Level Firewalling

With Cilium's [host firewall](https://docs.cilium.io/en/latest/security/host-firewall/) enabled, the same network policies that govern pod communication also enforce host-level networking rules. This extends cluster security to the underlying compute nodes, preventing host-to-pod and host-to-host communication that violates policy.

## Host OS Security

The cluster runs [Talos Linux](https://www.talos.dev/), a purpose-built, immutable Linux distribution for Kubernetes. Its security model includes:

- **Minimal surface** - Only essential binaries are included; no shell, package manager, or SSH by default
- **Immutable filesystem** - The root filesystem is read-only, making unauthorized modifications difficult
- **API-driven management** - Configuration is managed declaratively through the Talos API, making changes auditable and reproducible

This hardened foundation complements network policies by reducing the tools available for lateral movement or privilege escalation within compromised nodes.

## Summary

Together, these three layers create defense-in-depth security:

- Network segmentation prevents untrusted traffic from reaching the cluster
- In-cluster policies restrict traffic within the cluster to only necessary flows
- Talos Linux reduces the attack surface of individual nodes
