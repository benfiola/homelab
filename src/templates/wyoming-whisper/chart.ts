import {
  Chart,
  Deployment,
  Namespace,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const vaultAuth = new VaultAuth(chart);
  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const deployment = new Deployment(chart, "wyoming-whisper", {
    volumes: {
      cache: { emptyDir: {} },
      data: { emptyDir: {} },
    },
  });
  deployment.addContainer(
    "wyoming-whisper",
    "ghcr.io/benfiola/homelab-images/wyoming-whisper:1.0.3",
    {
      args: [
        "--hass-token=$(HASS_TOKEN)",
        "--hass-api=http://home-assistant.home-assistant.svc:8123/api",
        "--model=rhasspy/faster-whisper-base-int8",
        "--language=en",
        "--uri=tcp://0.0.0.0:10300",
        "--data-dir=/data",
        "--device=cuda",
      ],
      containerPorts: { wyoming: 10300 },
      env: {
        HASS_TOKEN: {
          secretKeyRef: { name: vaultSecret.name, key: "hass-token" },
        },
      },
      resources: {
        limits: {
          "nvidia.com/gpu": "1",
        },
        requests: {
          "nvidia.com/gpu": "1",
        },
      },
      volumeMounts: {
        cache: "/nonexistent/.cache",
        data: "/data",
      },
    },
  );

  deployment.createService({ wyoming: 10300 });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
