---
title: Security
---

This document outlines the security model for the homelab, which employs a layered approach: network segmentation via firewalling at the router, pod-level policies within the cluster, and a hardened host OS.

## Overview

Security is enforced across three layers:

1. **Router firewall** - Controls inter-VLAN traffic and public ingress based on a hierarchical VLAN trust model, with external access via WireGuard
2. **In-cluster policies** - Network policies and host-level firewalling restrict pod-to-pod and pod-to-host communication
3. **Host OS** - Talos Linux provides a minimal attack surface with reduced binary footprint

This defense-in-depth approach ensures that even if one layer is compromised, others remain to protect the cluster.

## Router Firewall

The network is split into VLANs, defined via the [networking configuration](/configuration/networking.md): `management`, `infrastructure`, `iot`, `personal`, `family`, and `friends`.

The cluster exposes one ingress Gateway per VLAN, plus a `public` Gateway for external/WAN traffic; each receives its own IP address. Rather than granting broad inter-VLAN access, firewall rules restrict each VLAN to its own Gateway plus the Gateways of any less-trusted VLANs beneath it:

- `friends` → `friends` ingress only
- `family` → `family` and `friends` ingress
- `personal` → `personal`, `family`, and `friends` ingress
- `infrastructure` → its own ingress, plus general access to the `iot` VLAN and the WAN
- `iot` → its own ingress only, isolated from the other VLANs (a small allowlist of IoT devices are permitted outbound WAN access)
- `management` → self-access only, used for administering network devices rather than reaching application traffic; it has no dedicated Gateway

Public (WAN) traffic is only permitted to reach the cluster via DNAT to the `public` Gateway.

### External Access

External access to the network is provided via WireGuard rather than a single flat VPN. Each peer is assigned to the VLAN matching its trust level (e.g. a peer in the `personal` WireGuard interface reaches the network the same as a device physically connected to the `personal` VLAN).

These firewall rules are defined statically as part of the router's [generated configuration](/configuration/networking.md), rather than being reconciled at runtime against cluster state.

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
