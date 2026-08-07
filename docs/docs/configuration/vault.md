---
title: Vault
---

Vault is the source-of-truth for application secrets managed through the Vault UI. The configuration files can be used to help initialize a Vault as a convenience.

## How It Works

During normal operation, secrets are managed directly through the Vault UI. However, when the Vault is being initialized:

- The vault generates its own root credentials. These are written directly to each vault pod's persistent volume (`/vault/data/root-token`, `/vault/data/unseal-key`) and are never pushed to remote storage.
- If `secrets-apps.yaml` exists, its application secrets can be pushed to the vault as a time-saving measure.

## Schema

### Vault Credentials

**File**: `config/secrets-vault.yaml`

A local-only backup of the credentials generated during vault initialization. This file is never synced to remote storage; it exists purely as a recovery mechanism so that if a vault pod is missing its credential files (e.g. after losing its volume) while vault is already initialized, bootstrapping can restore them without needing to re-initialize the vault - which is not possible once it's initialized, and would otherwise leave that pod permanently locked out. Bootstrapping only reads/writes this file when it detects a pod missing its credential files; it's left untouched otherwise.

| Field       | Type   | Required | Description                                        |
| ----------- | ------ | -------- | -------------------------------------------------- |
| `rootToken` | string | ✓        | Vault root token (generated during initialization) |
| `unsealKey` | string | ✓        | Vault unseal key (generated during initialization) |

### Application Secrets

**File**: `config/secrets-apps.yaml`

Application secrets and roles used to bootstrap the vault during initialization.

#### Secrets

Application secrets organized by app ID as key-value pairs.

| Field | Type   | Required | Description            |
| ----- | ------ | -------- | ---------------------- |
| Key   | string | ✗        | Application ID         |
| Value | object | ✗        | Secret key-value pairs |

Example:

```yaml
secrets:
  my-app:
    API_KEY: secret-value
    DB_PASSWORD: another-secret
```

#### Roles

Service account roles and their vault policy configurations generated during vault initialization. The generated policy name matches the role name.

| Field             | Type    | Required | Description                               |
| ----------------- | ------- | -------- | ----------------------------------------- |
| Key               | string  | ✗        | Role name                                 |
| `namespace`       | string  | ✓        | Kubernetes namespace ("\*" matches all)   |
| `service-account` | string  | ✓        | Kubernetes service account                |
| `secret`          | string  | ✗        | Secret subpath; omit to match all secrets |
| `policies`        | boolean | ✗        | Grant policy read access                  |
| `roles`           | boolean | ✗        | Grant role list/read access               |

Example:

```yaml
roles:
  my-app-role:
    namespace: my-app
    service-account: my-app-sa
    secret: my-app-secret
    policies: true
    roles: true
```
