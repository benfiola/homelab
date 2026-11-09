import type { AppFunction } from "../../tools/lib/app.ts";

// the worker nodes running a linstor satellite
// TODO: derive from talos/nodes.yaml
const workers = ["chihuahua", "husky", "malamute", "shiba"];

export const app: AppFunction = (h) => {
  const ns = h.namespace({ name: "piraeus-operator", external: true });

  ns.add(
    {
      apiVersion: "piraeus.io/v1",
      kind: "LinstorCluster",
      metadata: { name: h.app },
      spec: {
        nfsServer: { enabled: false },
        properties: [{ name: "DrbdOptions/auto-diskful", value: "10" }],
      },
    },
    {
      apiVersion: "piraeus.io/v1",
      kind: "LinstorSatelliteConfiguration",
      metadata: { name: h.app },
      spec: {
        podTemplate: {
          spec: {
            initContainers: [
              { name: "drbd-shutdown-guard", $patch: "delete" },
              { name: "drbd-module-loader", $patch: "delete" },
              {
                name: "linstor-provision-disk",
                image:
                  "ghcr.io/benfiola/homelab-images/linstor-provision-disk:1.1.8",
                securityContext: { privileged: true },
                volumeMounts: [{ name: "dev", mountPath: "/dev" }],
                env: [
                  { name: "PARTITION_LABEL", value: "r-linstor" },
                  { name: "VOLUME_GROUP", value: "vg" },
                  { name: "POOL", value: "linstor" },
                  {
                    name: "SATELLITE_ID",
                    valueFrom: {
                      fieldRef: {
                        fieldPath:
                          "metadata.labels['piraeus.io/linstor-satellite']",
                      },
                    },
                  },
                ],
              },
            ],
            volumes: [
              { name: "run-systemd-system", $patch: "delete" },
              { name: "run-drbd-shutdown-guard", $patch: "delete" },
              { name: "systemd-bus-socket", $patch: "delete" },
              { name: "lib-modules", $patch: "delete" },
              { name: "usr-src", $patch: "delete" },
              {
                name: "etc-lvm-backup",
                hostPath: {
                  path: "/var/etc/lvm/backup",
                  type: "DirectoryOrCreate",
                },
              },
              {
                name: "etc-lvm-archive",
                hostPath: {
                  path: "/var/etc/lvm/archive",
                  type: "DirectoryOrCreate",
                },
              },
              { name: "dev", hostPath: { path: "/dev" } },
            ],
          },
        },
        storagePools: [
          {
            name: h.app,
            lvmThinPool: { volumeGroup: "vg", thinPool: h.app },
          },
        ],
      },
    },
  );

  const advisory = { advisory: true };
  ns.vpa({ kind: "DaemonSet", name: "ha-controller" }, advisory);
  ns.vpa({ kind: "Deployment", name: "linstor-affinity-controller" }, advisory);
  ns.vpa({ kind: "Deployment", name: "linstor-controller" }, advisory);
  ns.vpa({ kind: "DaemonSet", name: "linstor-csi-nfs-server" }, advisory);
  ns.vpa({ kind: "DaemonSet", name: "linstor-csi-node" }, advisory);
  for (const node of workers) {
    ns.vpa({ kind: "DaemonSet", name: `linstor-satellite.${node}` }, advisory);
  }
};
