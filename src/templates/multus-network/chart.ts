import { NetworkAttachmentDefinition } from "../../../assets/multus/k8s.cni.cncf.io";
import { Chart, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  new NetworkAttachmentDefinition(
    chart,
    `${id}-network-attachment-definition-mdns`,
    {
      metadata: {
        name: "mdns",
      },
      spec: {
        config: JSON.stringify({
          cniVersion: "0.3.1",
          name: "mdns",
          type: "bridge",
          bridge: "mdns0",
          isGateway: true,
          ipam: {
            type: "host-local",
            subnet: "169.254.254.0/24",
          },
        }),
      },
    },
  );

  return chart;
};
