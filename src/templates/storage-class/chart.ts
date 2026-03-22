import { StorageClass } from "../../../assets/kubernetes/k8s";
import { Chart } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new StorageClass(chart, `${id}-storage-class-replicated`, {
    metadata: { name: `replicated` },
    provisioner: "linstor.csi.linbit.com",
    allowVolumeExpansion: true,
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      autoPlace: "2",
      storagePool: "linstor",
      "csi.storage.k8s.io/fstype": "ext4",
    },
  });

  new StorageClass(chart, `${id}-storage-class-standard`, {
    metadata: { name: `standard` },
    provisioner: "linstor.csi.linbit.com",
    allowVolumeExpansion: true,
    volumeBindingMode: "WaitForFirstConsumer",
    parameters: {
      autoPlace: "1",
      storagePool: "linstor",
      "csi.storage.k8s.io/fstype": "ext4",
    },
  });

  return chart;
};
