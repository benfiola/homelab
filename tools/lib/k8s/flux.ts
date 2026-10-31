type Obj = Record<string, any>;

export interface KustomizationOptions {
  // flux recreates objects it can't update
  force?: boolean;
  dependsOn?: string[];
}

// how an app's Flux Kustomization differs from the default (`export const flux`), or `false` for none
export type FluxDeclaration = false | KustomizationOptions;

// a Kustomization applying a path of the manifests repository (the GitRepository flux-system)
export const fluxKustomization = (
  name: string,
  path: string,
  opts: KustomizationOptions = {},
): Obj => ({
  apiVersion: "kustomize.toolkit.fluxcd.io/v1",
  kind: "Kustomization",
  metadata: { name, namespace: "flux-system" },
  spec: {
    ...(opts.dependsOn && {
      dependsOn: opts.dependsOn.map((name) => ({ name })),
    }),
    ...(opts.force && { force: true }),
    interval: "30s",
    path,
    prune: true,
    sourceRef: {
      kind: "GitRepository",
      name: "flux-system",
      namespace: "flux-system",
    },
  },
});

const defaults: KustomizationOptions = { force: true, dependsOn: [] };

// the Kustomization that deploys an app: the default, as its declaration changes it, or none
export const appKustomization = (
  app: string,
  declaration?: FluxDeclaration,
): Obj | undefined =>
  declaration === false
    ? undefined
    : fluxKustomization(app, `./apps/${app}`, { ...defaults, ...declaration });
