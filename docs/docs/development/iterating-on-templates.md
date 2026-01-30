---
title: Iterating on Templates
---

When developing or modifying templates, waiting for GitOps to reconcile changes is slow. By suspending Flux and applying changes directly, you can tighten your development loop significantly.

## Suspend GitOps Reconciliation

Start by suspending automatic reconciliation for the application you're working on:

```bash
flux suspend kustomization [app-name]
```

This prevents Flux from interfering while you iterate locally. You can verify suspension with:

```bash
flux get kustomization [app-name]
```

## Iterate Quickly

With reconciliation suspended, modify your template as needed.

Once you're ready to test, regenerate the manifests:

```bash
homelab generate-manifests --filter [app-name]
```

Apply the generated manifests directly to your cluster:

```bash
kubectl apply -f ./manifests/[app-name]/
```

See your changes immediately. Repeat this cycle—modify, regenerate, apply—as many times as needed without waiting for Flux reconciliation.

:::warning Manual Resource Cleanup
Because Flux reconciliation is suspended, **you're responsible for cleaning up any extra resources** you create during iteration. When you're done testing, manually delete resources that shouldn't persist:

```bash
kubectl delete -f ./manifests/[app-name]/
```

Or delete specific resources as needed.
:::

## Commit and Resume GitOps Reconciliation

Once you're satisfied with your changes, commit and then push them to Git.

Then, resume automatic reconciliation:

```bash
flux resume kustomization [app-name]
```

Verify reconciliation has resumed:

```bash
flux get kustomization [app-name]
```

Flux will eventually reconcile your updated template from Git to the cluster.
