type Obj = Record<string, any>;

// a share on the nas, mounted read-write by many pods: a PersistentVolume and the claim
// bound to it. mount it in a workload with `{ pvc: { name } }`.
export const nasVolume = (name: string): Obj[] => {
  const server = "nas.fiola.dev";
  const share = `/mnt/data/${name}`;
  const accessModes = ["ReadWriteMany"];
  const storage = "1Gi";

  return [
    {
      apiVersion: "v1",
      kind: "PersistentVolume",
      metadata: { name },
      spec: {
        accessModes,
        capacity: { storage },
        csi: {
          driver: "nfs.csi.k8s.io",
          volumeHandle: `${server}${share}`,
          volumeAttributes: { server, share },
        },
        mountOptions: ["nfsvers=4.1"],
        persistentVolumeReclaimPolicy: "Retain",
      },
    },
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: { name },
      spec: {
        accessModes,
        storageClassName: "",
        volumeName: name,
        resources: { requests: { storage } },
      },
    },
  ];
};
