---
title: Storage
---

This defines storage configuration used by the `homelab` CLI for remote storage operations.

## How It Works

Secrets are encrypted client-side using [age](https://age-encryption.org/) before being uploaded to a GCP Cloud Storage bucket. This means the storage provider only ever holds ciphertext — the bucket is a dumb byte store with no access to your data.

The **private key** used for decryption is stored in [Bitwarden](https://bitwarden.com/) and fetched at runtime via the Bitwarden CLI. The **public key** used for encryption is stored in plaintext in `storage.yaml` — it carries no secret value and is safe to commit.

When `homelab pull-secrets` runs, it:

1. Prompts for your Bitwarden master password to unlock the vault
2. Fetches the private key and writes it to `secrets-storage.yaml`
3. Uses the private key to decrypt each secret pulled from GCS

## Setup

### 1. Generate an age key pair

```bash
age-keygen
```

This prints the public key to stdout and the private key to stderr. Note both values.

### 2. Store the private key in Bitwarden

Create a login item in Bitwarden. Set the **password** field to the age private key (the line beginning with `AGE-SECRET-KEY-1...`). Copy the item's ID from the Bitwarden item URL or CLI:

```bash
bw list items --search <item-name> | jq '.[0].id'
```

### 3. Update `storage.yaml`

```yaml
bucket: your-bucket-name
privateKeyItemId: <bitwarden-item-id>
publicKey: age1...
```

## Configuration

**File**: `config/storage.yaml`

| Field              | Type   | Required | Description                                                      |
| ------------------ | ------ | -------- | ---------------------------------------------------------------- |
| `bucket`           | string | ✓        | GCP Cloud Storage bucket name                                    |
| `privateKeyItemId` | string | ✓        | Bitwarden item ID whose password field holds the age private key |
| `publicKey`        | string | ✓        | age public key used to encrypt secrets before upload             |

## Secrets

**File**: `config/secrets-storage.yaml`

This file is populated automatically by `homelab pull-secrets` from Bitwarden. It is never pushed to remote storage — `homelab push-secret storage` will fail with an error directing you to manage it in Bitwarden manually.

| Field        | Type   | Description                                        |
| ------------ | ------ | -------------------------------------------------- |
| `privateKey` | string | age private key, fetched from Bitwarden at runtime |
