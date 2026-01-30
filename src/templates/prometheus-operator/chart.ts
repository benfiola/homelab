import {
  Chart,
  findApiObject,
  Kustomization,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const chart = new Chart(construct, context.name);
  const id = chart.node.id;

  new Namespace(chart);

  const kustomization = await Kustomization.init(chart, `${id}-kustomization`, {
    dynamic: {
      namespace: chart.namespace,
      resources: [context.getAsset("manifest.yaml")],
    },
  });
  await patchEndpointSlicesSupport(kustomization);

  new VerticalPodAutoscaler(
    chart,
    findApiObject(chart, {
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "prometheus-operator",
    })
  );

  return chart;
};

const patchEndpointSlicesSupport = async (obj: Kustomization) => {
  const parent = obj.node.scope;
  if (!parent) {
    throw new Error(`node ${obj.node.id} has no parent`);
  }
  const id = parent.node.id;

  let resource = obj.node.findChild(`${id}-clusterrole`);
  const rules: Record<string, any>[] = (resource as any).props.rules;
  rules.forEach((val, index, array) => {
    const resources: string[] = val.resources;
    if (resources.indexOf("endpoints") !== -1) {
      array[index] = {
        apiGroups: ["discovery.k8s.io"],
        resources: ["endpointslices"],
        verbs: ["create", "delete", "get", "list", "update"],
      };
    }
  });

  resource = obj.node.findChild(`${id}-deployment-prometheus-operator`);
  const args: string[] = (resource as any).props.spec.template.spec
    .containers[0].args;
  args.forEach((val, index, array) => {
    if (val.indexOf("-kubelet-endpoints=true") !== -1) {
      array[index] = "--kubelet-endpoints=false";
    }
    if (val.indexOf("-kubelet-endpointslice=false") !== -1) {
      array[index] = "--kubelet-endpointslice=true";
    }
  });
};
