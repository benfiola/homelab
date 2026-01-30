---
slug: /
title: About
sidebar_position: 1
---

# Homelab

This project documents and helps administrate a Kubernetes cluster running on physical hardware out of a closet. It serves as both a learning platform and a production environment for containerized workloads.

## Goals

This project aims to:

- 🤖 Automate common operational tasks
- 📦 Generate per-app manifests for GitOps
- 📌 Track remote assets (Helm charts, manifests) locally
- 📉 Reduce boilerplate with TypeScript and cdk8s
- 📚 Document operations clearly for setup, maintenance, and debugging

## Hardware

<div style={{display: "flex", gap: "2rem", alignItems: "center"}}>
  <div style={{flex: "1 1 0"}}>
      <img
        src={require("/img/server-rack.png").default}
        alt="Server rack"
        className="zoom"
        style={{height: "100%", width: "100%", overflow: "hidden", objectFit: "cover",  borderRadius: ".4rem"}}
      />
  </div>
  <div style={{flex: "1 1 auto"}}>
    <ul>
      <li>Samson SRK16</li>
      <li>Nokia BGW320</li>
      <li>Mikrotik RB4011</li>
      <li>Mikrotik CRS326</li>
      <li>GL.iNet Flint 2</li>
      <li>Hue Bridge</li>
      <li>3x Rasperry Pi 4</li>
      <ul>
        <li>8GB RAM</li>
        <li>960GB SSD</li>
      </ul>
      <li>4x Lenovo Thinkcentre M70q/M80q/M90q</li>
      <ul>
        <li>Intel i7-10700T</li>
        <li>64GB RAM</li>
        <li>2TB SSD</li>
      </ul>
    </ul>
  </div>
</div>

## Getting Started

Ready to get started? See [Getting Started](/getting-started.md).
