import { Chart, Deployment, HttpRoute, Namespace } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart, { privileged: true });

  const deployment = new Deployment(chart, "home-assistant", {
    securityContext: { gid: 0, uid: 0 },
  });
  deployment.addContainer(
    "home-assistant",
    "ghcr.io/home-assistant/home-assistant:2026.5.4",
    {
      env: {
        TZ: "America/Los_Angeles",
      },
      containerPorts: {
        web: [8123, "TCP"],
      },
    },
  );

  const service = deployment.createService({ web: 8123 });

  new HttpRoute(chart, "users", "home-assistant.bulia.dev").match(
    service,
    8123,
  );

  return chart;
};
