import { Chart } from "cdk8s";
import { writeFile } from "fs/promises";
import { StorageClass } from "../resources/k8s/k8s";
import { LinstorSatelliteConfiguration } from "../resources/piraeus/piraeus.io";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createKustomization } from "../utils/createKustomization";
import {
  createNetworkPolicy,
  createTargets,
  PortsMap,
} from "../utils/createNetworkPolicy";

const version = "2.9.0";
const appData = {
  manifest: `https://github.com/piraeusdatastore/piraeus-operator/releases/download/v${version}/manifest.yaml`,
};

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
    haController: piraeus("ha-controller", { svc: [3370, "tcp"] }),
    linstorController: piraeus("linstor-controller", {
      svc: [3370, "tcp"],
    }),
    linstorCsiController: piraeus("linstor-csi-controller"),
    linstorCsiNode: piraeus("linstor-csi-node"),
    linstorSatellite: piraeus("linstor-satellite", {
      svc: [3366, 3367, "tcp"],
      drbd: [7000, 7999, "tcp"],
    }),
    operator: piraeus("piraeus-operator", { webhook: [9443, "tcp"] }),
  };
});

const manifests: ManifestsCallback = async (app) => {
  const { policyTargets: kubeTargets } = await import("./k8s");
  const { LinstorCluster } = await import("../resources/piraeus/piraeus.io");

  const chart = new Chart(app, "piraeus", {
    namespace,
  });

  createNetworkPolicy(chart, (b) => {
    const kt = kubeTargets;
    const pt = policyTargets;
    const remoteNode = b.target({ entity: "remote-node" });

    b.rule(pt.gencert, kt.apiServer, "api");
    b.rule(pt.haController, kt.apiServer, "api");
    b.rule(pt.linstorController, kt.apiServer, "api");
    b.rule(pt.linstorController, pt.haController, "svc");
    b.rule(pt.linstorController, pt.linstorSatellite, "svc");
    b.rule(pt.linstorCsiController, kt.apiServer, "api");
    b.rule(pt.linstorCsiController, pt.linstorController, "svc");
    b.rule(pt.linstorCsiNode, pt.linstorController, "svc");
    b.rule(pt.linstorSatellite, pt.linstorSatellite, "drbd");
    b.rule(pt.operator, kt.apiServer, "api");
    b.rule(pt.operator, pt.linstorController, "svc");
    b.rule(remoteNode, pt.operator, "webhook");
  });

  await createKustomization(chart, "manifest", {
    namespace: chart.namespace,
    resources: [appData.manifest],
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
  const manifest = await fetch(appData.manifest).then((r) => r.text());
  await writeFile(manifestsFile, manifest);
};

export default function async(context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
