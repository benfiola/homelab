import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  h.namespaceName = "intel-device-plugins-operator";

  h.helm(
    "https://intel.github.io/helm-charts/intel-device-plugins-gpu?version=0.37.1",
    { release: "intel-device-plugins", values: "values.yaml" },
  );
};
