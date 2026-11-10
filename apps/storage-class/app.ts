import type { AppFunction } from "../../tools/lib/app.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  ns.add({
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: {
      name: "replicated",
    },
    allowVolumeExpansion: true,
    parameters: {
      autoPlace: "2",
      "csi.storage.k8s.io/fstype": "ext4",
      storagePool: "linstor",
    },
    provisioner: "linstor.csi.linbit.com",
    volumeBindingMode: "WaitForFirstConsumer",
  });

  ns.add({
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: {
      name: "standard",
    },
    allowVolumeExpansion: true,
    parameters: {
      autoPlace: "1",
      "csi.storage.k8s.io/fstype": "ext4",
      storagePool: "linstor",
    },
    provisioner: "linstor.csi.linbit.com",
    volumeBindingMode: "WaitForFirstConsumer",
  });

  ns.add({
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: {
      name: "nas",
    },
    allowVolumeExpansion: true,
    mountOptions: ["nfsvers=4.1"],
    parameters: {
      server: "nas.fiola.dev",
      share: "/mnt/data/pvcs",
    },
    provisioner: "nfs.csi.k8s.io",
    volumeBindingMode: "WaitForFirstConsumer",
  });
};
