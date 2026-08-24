import {
  Chart,
  Deployment,
  Namespace,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  // the image runs as appuser (uid/gid 1001), which owns /app; matching it
  // here avoids permission errors when the app writes to /app/api/temp_files
  const deployment = new Deployment(chart, "kokoro-fastapi", {
    securityContext: { uid: 1001, gid: 1001 },
  });

  deployment.addContainer(
    "kokoro-fastapi",
    "ghcr.io/remsky/kokoro-fastapi-gpu:v0.8.1-cu128",
    {
      env: {
        USE_GPU: "true",
      },
      containerPorts: { http: 8880 },
      resources: {
        limits: {
          "nvidia.com/gpu": "1",
        },
        requests: {
          "nvidia.com/gpu": "1",
        },
      },
      readiness: {
        http: { path: "/health", port: 8880 },
        initialDelaySeconds: 30,
        periodSeconds: 30,
        timeoutSeconds: 5,
      },
      liveness: {
        http: { path: "/health", port: 8880 },
        initialDelaySeconds: 30,
        periodSeconds: 30,
        timeoutSeconds: 5,
      },
    },
  );

  deployment.createService({ http: 8880 });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
