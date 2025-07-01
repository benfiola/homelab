import { Chart, Include } from "cdk8s";
import { writeFile } from "fs/promises";
import { StorageClass } from "../resources/k8s/k8s";
import { LinstorSatelliteConfiguration } from "../resources/piraeus/piraeus.io";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import {
  createNetworkPolicy,
  createTargets,
  PortsMap,
  specialTargets,
} from "../utils/createNetworkPolicyNew";

const appData = {
  version: "2.9.0",
};

// NOTE: do not change this - it's baked into the manifest that installs the operator
const namespace = "piraeus-datastore";

const policyTargets = createTargets((b) => {
  const piraeus = <PM extends PortsMap>(component: string, ports?: PM) => {
    return b.target({
      endpoint: {
        "app.kubernetes.io/component": component,
        "io.kubernetes.pod.namespace": namespace,
        "app.kubernetes.io/name": "piraeus-datastore",
      },
      ports: (ports || {}) as PM,
    });
  };

  return {
    gencert: piraeus("piraeus-operator-gencert"),
    haController: piraeus("ha-controller", { default: [3370, "tcp"] }),
    linstorController: piraeus("linstor-controller", {
      default: [3370, "tcp"],
    }),
    linstorCsiController: piraeus("linstor-csi-controller"),
    linstorCsiNode: piraeus("linstor-csi-node"),
    linstorSatellite: piraeus("linstor-satellite", {
      default: [3366, 3367, "tcp"],
      drbd: [7000, 7999, "tcp"],
    }),
    operator: piraeus("piraeus-operator", { default: [9443, "tcp"] }),
  };
});

const manifests: ManifestsCallback = async (app) => {
  const { LinstorCluster } = await import("../resources/piraeus/piraeus.io");

  const chart = new Chart(app, "piraeus", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    const remoteNode = b.target({ entity: "remote-node", ports: {} });
    b.rule(policyTargets.gencert, specialTargets.kubeApiserver);
    b.rule(policyTargets.haController, specialTargets.kubeApiserver);
    b.rule(policyTargets.linstorController, specialTargets.kubeApiserver);
    b.rule(policyTargets.linstorController, policyTargets.haController);
    b.rule(policyTargets.linstorController, policyTargets.linstorSatellite);
    b.rule(policyTargets.linstorCsiController, specialTargets.kubeApiserver);
    b.rule(policyTargets.linstorCsiController, policyTargets.linstorController);
    b.rule(policyTargets.linstorCsiNode, policyTargets.linstorController);
    b.rule(
      policyTargets.linstorSatellite,
      policyTargets.linstorSatellite,
      "drbd"
    );
    b.rule(policyTargets.operator, specialTargets.kubeApiserver);
    b.rule(policyTargets.operator, policyTargets.linstorController);
    b.rule(remoteNode, policyTargets.operator);
  });

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
          name: "piraeus",
          lvmThinPool: { volumeGroup: "vg", thinPool: "piraeus" },
        },
      ],
    },
  });

  new StorageClass(chart, "storage-class", {
    metadata: { name: "piraeus" },
    provisioner: "linstor.csi.linbit.com",
    allowVolumeExpansion: true,
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      autoPlace: "2",
      storagePool: "piraeus",
      "csi.storage.k8s.io/fstype": "ext4",
    },
  });

  new StorageClass(chart, "backup-storage-class", {
    metadata: { name: "piraeus-backup" },
    provisioner: "linstor.csi.linbit.com",
    allowVolumeExpansion: true,
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      autoPlace: "1",
      storagePool: "piraeus",
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
