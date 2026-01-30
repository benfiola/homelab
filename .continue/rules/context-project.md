---
name: Context (Project)
alwaysApply: true
description: Describes this project
---

# Project

This repository hosts my infrastructure-as-code project that targets a Kubernetes cluster I'm running out of a closet. It hosts configuration files (path: `config`), documentation (path: `docs`) and a typescript project (path: `src`) for various automated tasks via a CLI (`homelab`) located at `src/cli.ts`.

Templates are logical groupings of resources (path: `src/templates`). They can produce cdk8s `Chart` resources (path: `src/templates/**/chart.ts`) - and can also produce assets (path: `src/templates/**/asset.ts`). Assets are resources fetched from the internet, committed to the repo, and can be used to produce manifests in an effort to decouple remote resources from manifest generation.

Applications are instances of deployment units produced through these templates. They're configured via `config/apps.yaml` - each app references a template by name (`name`), provides an optional `id` for the app, and options to pass to the template (`opts`).

The goals of this project are:

- Automate common administration tasks (e.g., cluster bootstrapping via `homelab bootstrap`)
- Wrap CLIs with convenience functionality (e.g., `homelab talosctl` wraps the `talosctl` CLI but can translate node names to their actual DNS names)
- Clearly represent the origins of remote content (e.g., helm charts and manifests) such that administrative tasks like version upgrades can be performed by changing a single versio nstring.
- Define deployed applications in a common language, while reducing the amount of boilerplate required to express these resources.
- (Re)fetch remote assets per-template (e.g., `homelab refresh-assets`).
- Generate manifests per-app (e.g., `homelab generate-manifests`).
