---
title: Storage
---

This defines storage configuration used by the `homelab` CLI for remote storage operations.

## How It Works

Currently, in conjunction with the `gcloud` CLI, this is used to store and retrieve secret data not committed to your repository. This is done to persist secret content while keeping this data outside of the repository.

## Configuration

Specifies the GCP Cloud Storage bucket:

```yaml
bucket: your-bucket-name
```

## Schema

**File**: `config/storage.yaml`

| Field    | Type   | Required | Description                   |
| -------- | ------ | -------- | ----------------------------- |
| `bucket` | string | ✓        | GCP Cloud Storage bucket name |
