import { Chart } from "cdk8s";
import { PersistentVolumeClaim, Quantity } from "../resources/k8s/k8s";
import { getStorageClassName } from "./getStorageClassName";

interface CreatePersistentVolumeClaimOpts {
  name: string;
  size: string;
}

export const createPersistentVolumeClaim = (
  chart: Chart,
  id: string,
  opts: CreatePersistentVolumeClaimOpts
) => {
  return new PersistentVolumeClaim(chart, id, {
    metadata: { namespace: chart.namespace, name: opts.name },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: Quantity.fromString(opts.size),
        },
      },
      storageClassName: getStorageClassName(),
    },
  });
};
