import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = async (h) => {
  await h
    .namespace()
    .kustomize(
      "github.com/kubernetes-csi/external-snapshotter/client/config/crd?ref=v8.7.0",
    );
};
