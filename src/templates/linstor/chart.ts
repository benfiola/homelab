import {
  LinstorCluster,
  LinstorSatelliteConfiguration,
} from "../../../assets/piraeus-operator/piraeus.io";
import { Chart, VerticalPodAutoscaler } from "../../cdk8s";
import { getClusterConfig, getNodeConfig, listNodes } from "../../config";
import { TemplateChartContext, TemplateChartFn } from "../../context";
import { homelabHelper } from "../../homelab-helper";

const getNodes = async (context: TemplateChartContext) => {
  const clusterConfig = await getClusterConfig(context.configDir);
  const nodeNames = await listNodes(context.configDir);
  const nodeConfigs = await Promise.all(
    nodeNames.map((n) => getNodeConfig(context.configDir, n)),
  );

  const nodes: string[] = [];
  const endpoint = clusterConfig.endpoint;
  for (const nodeConfig of nodeConfigs) {
    if (!nodeConfig.enabled || nodeConfig.role === "controlplane") {
      continue;
    }
    const nodeHostname = nodeConfig.hostname;
    const node = nodeHostname.replace(`.${endpoint}`, "");
    nodes.push(node);
  }

  nodes.sort();

  return nodes;
};

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name, {
    namespace: "piraeus-operator",
  });
  const id = chart.node.id;

  // these are cluster scoped resources that will be deployed wherever `piraeus-operator` is deployed.
  new LinstorCluster(chart, `${id}-cluster`, {
    metadata: { name: id },
  });

  new LinstorSatelliteConfiguration(chart, `${id}-satellite-configuration`, {
    metadata: { name: id },
    spec: {
      podTemplate: {
        spec: {
          initContainers: [
            { name: "drbd-shutdown-guard", $patch: "delete" },
            { name: "drbd-module-loader", $patch: "delete" },
            {
              name: "linstor-provision-disk",
              image: homelabHelper.image,
              args: ["homelab-helper", "linstor-provision-disk"],
              securityContext: { privileged: true },
              volumeMounts: [
                {
                  name: "dev",
                  mountPath: "/dev",
                },
              ],
              env: [
                {
                  name: "PARTITION_LABEL",
                  value: "r-linstor",
                },
                {
                  name: "VOLUME_GROUP",
                  value: "vg",
                },
                {
                  name: "POOL",
                  value: "linstor",
                },
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
            {
              name: "dev",
              hostPath: { path: "/dev" },
            },
          ],
        },
      },
      storagePools: [
        {
          name: id,
          lvmThinPool: { volumeGroup: "vg", thinPool: id },
        },
      ],
    },
  });

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "ha-controller",
    },
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "linstor-affinity-controller",
    },
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "linstor-controller",
    },
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "linstor-csi-nfs-server",
    },
    { advisory: true },
  );

  new VerticalPodAutoscaler(
    chart,
    {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "linstor-csi-node",
    },
    { advisory: true },
  );

  const nodes = await getNodes(context);
  for (const node of nodes) {
    new VerticalPodAutoscaler(
      chart,
      {
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        name: `linstor-satellite.${node}`,
      },
      { advisory: true },
    );
  }

  return chart;
};
