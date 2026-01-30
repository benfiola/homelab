---
title: Flux
---

Flux is a GitOps operator that reconciles application deployments from a Git repository. Configuration is split across two files: one committed (repository details) and one kept secret (authentication).

:::warning Bootstrap-Only Setup
This configuration is used during `homelab bootstrap` to initialize Flux. After bootstrap, Flux operates independently. Keep these files locally if you need to re-bootstrap (to avoid regenerating tokens).
:::

## How It Works

### Configuration and Secrets Separation

Flux requires both configuration details (repository URL) and authentication credentials. These are kept in separate files following the GitOps principle of separating infrastructure configuration from secrets:

- **`config/flux.yaml`**: Repository URL and optional branch, committed to your repository
- **`config/secrets-flux.yaml`**: Authentication token, stored separately and never committed

### Repository Visibility and Security

The Git repository containing your manifests can be either public or private. If using a public repository, audit generated manifests to ensure no secrets or sensitive data are included. Flux itself reads from the repository but does not write to it.

:::note GitHub Fine-Grained Token Permissions
GitHub fine-grained tokens should have:

- Read access to _Metadata_
- Read/Write access to _Administration_.

Metadata access allows Flux to verify repository permissions; Administration access allows Flux to manage deployment configuration.
:::

## Examples

### config/flux.yaml

Specifies the Git repository and branch where Flux manifests are stored:

```yaml
repo: https://github.com/username/manifests.git
branch: main
```

### config/secrets-flux.yaml

Contains the authentication token for accessing the Git repository:

```yaml
token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Schema

### Flux Configuration

**File**: `config/flux.yaml`

| Field    | Type   | Required | Description                           |
| -------- | ------ | -------- | ------------------------------------- |
| `repo`   | string | ✓        | Git repository URL for Flux manifests |
| `branch` | string |          | Git branch to deploy (optional)       |

### Flux Secrets

**File**: `config/secrets-flux.yaml`

| Field   | Type   | Required | Description                                    |
| ------- | ------ | -------- | ---------------------------------------------- |
| `token` | string | ✓        | Authentication token for Git repository access |
