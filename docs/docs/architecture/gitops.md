---
title: GitOps
---

This document outlines the GitOps architecture for this project and how changes flow from code to cluster.

## Overview

The GitOps workflow uses FluxCD to automatically reconcile application deployments from a Git repository. The flow involves three key components:

1. **Public repository** (this project) - Contains the infrastructure-as-code configuration
2. **Private repository** - Stores generated manifests that Flux reconciles from
3. **Kubernetes cluster** - Runs FluxCD controllers that detect and apply changes

## Data Flow

### 1. Flux Initialization

When [bootstrapping](/getting-started.md) the cluster, the `homelab bootstrap` command orchestrates Flux's initialization by invoking the Flux CLI, which:

- Configures a deploy token for the manifest repository
- Pushes the Flux system configuration to the manifest repository
- Deploys FluxCD controllers to the cluster
- Enables the cluster to reconcile Flux's own configuration

### 2. Application Reconciliation

Once Flux is operational, an additional manifest (`flux-bootstrap`) is applied to the cluster. This creates a `Kustomization` resource that points to an app named `flux`, which defines all applications Flux should manage. This follows the app-of-apps pattern: Flux not only manages individual applications but also manages the set of applications it needs to manage. This allows automatic cleanup when applications are removed from the project.

### 3. Manifest Generation and Deployment

The [public repository](https://github.com/benfiola/homelab) is configured with a GitHub Action that:

- Sets up the runtime environment
- Generates manifests via `homelab generate-manifests`
- Commits the manifests to the [private repository](https://github.com/benfiola/homelab-manifests)

Flux continuously monitors the private repository and automatically deploys any changes it detects.

## Summary

This architecture creates a clean separation between configuration (public) and deployment state (private). Changes made to this repository are automatically committed to the manifest repository and deployed to the cluster—enabling a fully automated GitOps workflow.
