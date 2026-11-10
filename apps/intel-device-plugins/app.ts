import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = async (h) => {
  await h
    .namespace({ name: "intel-device-plugins-operator", external: true })
    .helm(
      "https://intel.github.io/helm-charts/intel-device-plugins-gpu?version=0.37.1",
      {
        release: "intel-device-plugins",
        values: { name: "gpu-device-plugin", sharedDevNum: 127 },
      },
    );
};
