import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.kustomize(
    "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.3/experimental-install.yaml",
  );
};
