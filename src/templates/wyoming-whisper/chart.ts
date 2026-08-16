import { readFile } from "fs/promises";
import path from "path";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  AssetsServer,
  BucketSyncAuth,
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

  const bucketSyncAuth = new BucketSyncAuth(chart);
  const assetsServer = new AssetsServer(chart, bucketSyncAuth);

  const vaultAuth = new VaultAuth(chart);
  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    data: {
      "download-model.sh": (
        await readFile(path.join(__dirname, "download-model.sh"))
      ).toString(),
    },
  });

  const files = {
    cacheArchive: "huggingface-cache.tar.gz",
  } as const;

  const deployment = new Deployment(chart, "wyoming-whisper", {
    volumes: {
      models: { emptyDir: {} },
      scripts: { configMap: scripts.name },
    },
  });

  deployment.addInitContainer(
    "download-model",
    "ghcr.io/benfiola/homelab-images/toolbox:1.1.0",
    {
      args: [
        "bash",
        "/scripts/download-model.sh",
        assetsServer.url(),
        "/data",
        files.cacheArchive,
      ],
      volumeMounts: {
        models: "/data",
        scripts: "/scripts",
      },
    },
  );

  deployment.addContainer(
    "wyoming-whisper",
    "docker.io/rhasspy/wyoming-whisper:3.6.0",
    {
      args: [
        "--hass-token=$(HASS_TOKEN)",
        "--hass-api=http://home-assistant.home-assistant.svc:8123",
        "--model=rhasspy/faster-whisper-base-int8",
        "--language=en",
        "--uri=tcp://0.0.0.0:10300",
        "--data-dir=/data",
        "--device=cuda",
        "--local-files-only",
      ],
      containerPorts: { wyoming: 10300 },
      env: {
        HF_HOME: "/data",
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
        models: "/data",
      },
    },
  );

  deployment.createService({ wyoming: 10300 });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
