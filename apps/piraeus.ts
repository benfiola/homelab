import { Chart, Include } from "cdk8s";
import { writeFile } from "fs/promises";
import { StorageClass } from "../resources/k8s/k8s";
import { LinstorSatelliteConfiguration } from "../resources/piraeus/piraeus.io";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";

const appData = {
  version: "2.9.0",
};

const manifests: ManifestsCallback = async (app) => {
  const { LinstorCluster } = await import("../resources/piraeus/piraeus.io");

  const chart = new Chart(app, "piraeus", {
    // NOTE: do not change this - it's baked into the manifest that installs the operator
    namespace: "piraeus-datastore",
  });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { piraeus: "ha-controller" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { piraeus: "linstor-controller" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { piraeus: "linstor-csi-controller" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { piraeus: "piraeus-operator" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
    {
      from: { piraeus: "piraeus-operator-gencert" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { piraeus: "linstor-controller" },
      to: { piraeus: "ha-controller", ports: [[3370, "tcp"]] },
    },
    {
      from: { piraeus: "linstor-csi-node" },
      to: { piraeus: "linstor-controller", ports: [[3370, "tcp"]] },
    },
    {
      from: { piraeus: "linstor-csi-controller" },
      to: { piraeus: "linstor-controller", ports: [[3370, "tcp"]] },
    },
    {
      from: { piraeus: "piraeus-operator" },
      to: { piraeus: "linstor-controller", ports: [[3370, "tcp"]] },
    },
    {
      from: { piraeus: "linstor-controller" },
      to: { piraeus: "linstor-satellite", ports: [[3366, "tcp"]] },
    },
    {
      from: { piraeus: "linstor-satellite" },
      to: {
        piraeus: "linstor-satellite",
        ports: [[[7000, 7999], "tcp"]],
      },
    },

    {
      from: { entity: "remote-node" },
      to: {
        piraeus: "piraeus-operator",
        ports: [[9443, "tcp"]],
      },
    },
  ]);

  new Include(chart, "manifest", {
    url: `https://github.com/piraeusdatastore/piraeus-operator/releases/download/v${appData.version}/manifest.yaml`,
  });

  new LinstorCluster(chart, "cluster", {
    metadata: { name: "default" },
  });

  new LinstorSatelliteConfiguration(chart, "staellite-configuration", {
    metadata: { name: "default" },
    spec: {
      podTemplate: {
        spec: {
          initContainers: [
            { name: "drbd-shutdown-guard", $patch: "delete" },
            { name: "drbd-module-loader", $patch: "delete" },
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
          ],
        },
      },
      storagePools: [
        {
          name: "lvm-thin",
          lvmThinPool: { volumeGroup: "vg-storage", thinPool: "thin-pool" },
        },
      ],
    },
  });

  new StorageClass(chart, "storage-class", {
    metadata: { name: "lvm-thin" },
    provisioner: "linstor.csi.linbit.com",
    allowVolumeExpansion: true,
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      autoPlace: "2",
      storagePool: "lvm-thin",
      "csi.storage.k8s.io/fstype": "ext4",
    },
  });

  new StorageClass(chart, "backup-storage-class", {
    metadata: { name: "lvm-thin-backup" },
    provisioner: "linstor.csi.linbit.com",
    allowVolumeExpansion: true,
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      autoPlace: "1",
      storagePool: "lvm-thin",
      "csi.storage.k8s.io/fstype": "ext4",
    },
  });

  return chart;
};

export const resources: ResourcesCallback = async (manifestsFile) => {
  const url = `https://github.com/piraeusdatastore/piraeus-operator/releases/download/v${appData.version}/manifest.yaml`;
  const manifest = await fetch(url).then((r) => r.text());
  await writeFile(manifestsFile, manifest);
};

export default function async(context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
