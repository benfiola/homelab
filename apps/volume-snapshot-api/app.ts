import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.kustomize(
    "github.com/kubernetes-csi/external-snapshotter/client/config/crd?ref=v8.7.0",
    { namespace: true },
  );
};
