import {
  Chart,
  findApiObject,
  Kustomization,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const kustomization = await Kustomization.init(chart, `${id}-kustomization`, {
    dynamic: {
      namespace: chart.namespace,
      resources: [context.getAsset("manifest.yaml")],
      labels: [
        {
          includeSelectors: true,
          pairs: {
            "app.kubernetes.io/name": "multus",
          },
        },
      ],
    },
  });
  await patchForTalos(kustomization);

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "DaemonSet",
      name: "kube-multus-ds",
    }),
    { advisory: true },
  );

  return chart;
};

const patchForTalos = async (obj: Kustomization) => {
  const parent = obj.node.scope;
  if (!parent) {
    throw new Error(`node ${obj.node.id} has no parent`);
  }
  const id = parent.node.id;

  const daemonset = obj.node.findChild(`kube-multus-ds-daemonset-${id}`);
  if (!daemonset) {
    throw new Error("Could not find kube-multus-ds DaemonSet");
  }

  const spec = (daemonset as any).props.spec.template.spec;

  // Talos fix: Mount /var/run/netns instead of /run/netns
  const hostRunNetnsVolume = spec.volumes.find(
    (v: any) => v.name === "host-run-netns",
  );
  if (hostRunNetnsVolume) {
    hostRunNetnsVolume.hostPath.path = "/var/run/netns";
  }

  const hostRunNetnsMount = spec.containers[0].volumeMounts.find(
    (v: any) => v.name === "host-run-netns",
  );
  if (hostRunNetnsMount) {
    hostRunNetnsMount.mountPath = "/var/run/netns";
  }

  // Talos fix: Add sleep after binary installation to prevent race conditions
  const initContainer = spec.initContainers[0];
  initContainer.command = [
    "/bin/sh",
    "-c",
    "cp /usr/src/multus-cni/bin/multus /host/opt/cni/bin/ && sleep 5",
  ];

  // Increase memory limit from 50Mi to 150Mi
  spec.containers[0].resources.requests.memory = "150Mi";
  spec.containers[0].resources.limits.memory = "150Mi";
};
