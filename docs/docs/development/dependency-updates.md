---
title: Dependency Updates
---

[Renovate](https://docs.renovatebot.com) tracks dependency updates. It is configured in `renovate.json`, and its **Dependency Dashboard** issue lists pending updates and everything it detected.

No pull request is opened until its checkbox is ticked in the dashboard: merging to `main` publishes manifests that Flux then applies to the cluster, so each update is an explicit decision.

## Tracking a dependency

npm, GitHub Actions and devcontainers are tracked automatically, as are the following patterns in `src/`:

- `helm.pull({ repo, chart, version })` and `helm.pull({ chart: "oci://...", version })` in a template's `asset.ts`.
- Container image references (`"[registry/]path/name:tag"`) in templates.

Anything else is tracked with a comment on the line above the version (`//` in TypeScript):

```ts
// renovate: datasource=github-releases depName=fluxcd/flux2 extractVersion=^v(?<version>.+)$
const version = "2.7.3";
```

`versioning` and `extractVersion` are optional. For repositories without releases, track a commit with `datasource=git-refs depName=<repo url> branch=<branch>` above a 40-character sha.

## Pinning a dependency

Versions held back for this environment are marked so they stay visible in the dashboard without being updated:

```sh
# renovate-pinned: depName=cuda reason=matches the host GPU driver
CUDA_VERSION ?= 12.4
```

The version is always read from the line below (after the last `:` or `=`), never from the comment, so it cannot drift from the real value.

The Talos and Kubernetes versions (in `config/cluster.yaml` and the Makefile) are pinned this way: cluster upgrades are performed manually with `talosctl`, so a merged pull request cannot apply them.

## Asset updates

Bumping a version in a template's `asset.ts` changes what `homelab refresh-assets` produces, and the result is committed under `assets/`. The `refresh-assets` workflow handles this for Renovate pull requests (branches starting with `renovate/`):

1. It detects which templates' `asset.ts` changed in the pull request.
2. It runs `homelab refresh-assets --filter <templates>` and commits any changes under `assets/` to the branch.
3. It runs `homelab generate-manifests` to confirm the templates still work with the refreshed assets. A failure here means the update needs manual changes to a template.

Renovate ignores the workflow's commits (`gitIgnoredAuthors`), so it keeps rebasing the pull request.

## Rule types

Each rule in `renovate.json` starts its `description` with its type:

- `GROUPING`: updates that must land in one PR (dependencies sharing a name across files already do).
- `VERSIONS`: which versions are allowed, or what is tracked.
- `PINNED`: backs `renovate-pinned`.
- `PR NOTE`: reminder added to the PR body.
