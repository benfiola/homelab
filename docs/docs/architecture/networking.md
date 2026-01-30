---
title: Networking
---

This document outlines how traffic is routed and segmented across the homelab network.

## Overview

The network uses VLANs to segregate traffic by device type and trust level. All traffic flows through a central switch connected to a router, which enforces inter-VLAN routing and firewall rules.

```mermaid
graph TD
    modem["Nokia BGW320"]
    router["Mikrotik RB4011"]
    switch["Mikrotik CRS326"]

    subgraph wifi-aps["Wi-fi APs"]
        wifi-ap-bedroom-2["GL.iNet Flint 2 (Bedroom 2)<br/>VLAN: 8, 16, 24"]
        wifi-ap-living-room["GL.iNet Flint 2 (Living Room)<br/>VLAN: 8, 16, 24"]
        wifi-ap-office["GL.iNet Flint 2 (Office)<br/>VLAN: 8, 16, 24"]
    end

    subgraph K8s["Kubernetes Cluster"]
        node-a["node-a<br/>VLAN: 32"]
        node-b["node-b<br/>VLAN: 32"]
        node-c["node-c<br/>VLAN: 32"]
        node-d["node-d<br/>VLAN: 32"]
        node-e["node-e<br/>VLAN: 32"]
        node-f["node-f<br/>VLAN: 32"]
        node-g["node-g<br/>VLAN: 32"]
    end

    hardwired-client-1["Desktop<br/>VLAN: 16"]
    wifi-client-1["Friend's Phone<br/>VLAN: 8"]
    wifi-client-2["Laptop<br/>VLAN: 16"]
    wifi-client-3["Thermostat<br/>VLAN: 24"]

    modem --- router
    router --- switch

    switch --- wifi-ap-bedroom-2
    switch --- wifi-ap-living-room
    switch --- wifi-ap-office

    switch --- node-a
    switch --- node-b
    switch --- node-c
    switch --- node-d
    switch --- node-e
    switch --- node-f
    switch --- node-g

    switch --- hardwired-client-1

    wifi-aps -.- wifi-client-1
    wifi-aps -.- wifi-client-2
    wifi-aps -.- wifi-client-3
```

## VLANs

Four VLANs segregate network traffic:

| VLAN ID | Name           | Purpose                           |
| ------- | -------------- | --------------------------------- |
| 8       | General        | Guest and untrusted devices       |
| 16      | Trusted        | Personal devices                  |
| 24      | IoT            | Smart home devices                |
| 32      | Infrastructure | Kubernetes cluster and management |

Each VLAN ID corresponds to a `/24` CIDR range.

:::info Infrastructure
The _Infrastructure_ VLAN is an exception—it uses a `/23` CIDR range, with one `/24` slice reserved for the router and the other for in-cluster IPAM.

This separation prevents IPAM from colliding with upstream DHCP allocations.
:::

## Architecture

### Access Ports

Devices connected directly to the switch (like cluster nodes and the desktop) are configured on static access ports. Each access port is tagged to a single VLAN.

### Trunk Ports

Wi-Fi access points are connected to the switch via trunk ports. Each physical Wi-Fi network broadcasts a specific VLAN, allowing the same access point to serve multiple networks (e.g., a guest network and a trusted network simultaneously).

### Router

The switch connects to the router via a trunk port carrying all VLANs. The router's firewall enforces inter-VLAN routing rules, controlling which VLANs can communicate with each other.

## In-Cluster Networking

In-cluster, there are several `Gateway` resources—each receiving a distinct `LoadBalancer`-type service. These receive IP addresses from the in-cluster IPAM pool within the _Infrastructure_ VLAN. The cluster CNI is configured to peer these IP addresses with the upstream router, making them discoverable on the broader network.

## Further Reading

Refer to [Security](./security.md) for more info about firewall rules and in-cluster networking policies.
