import { readFile } from "fs/promises";
import path from "path";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  AssetsServer,
  BucketSyncAuth,
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

  const bucketSyncAuth = new BucketSyncAuth(chart);
  const assetsServer = new AssetsServer(chart, bucketSyncAuth);

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    data: {
      "download-voices.sh": (
        await readFile(path.join(__dirname, "download-voices.sh"))
      ).toString(),
    },
  });

  const files = {
    onnx: "en_US-lessac-high.onnx",
    json: "en_US-lessac-high.onnx.json",
  } as const;

  const modelName = path.basename(files.onnx, ".onnx");

  const deployment = new Deployment(chart, "wyoming-piper", {
    volumes: {
      voices: { emptyDir: {} },
      scripts: { configMap: scripts.name },
    },
  });

  deployment.addInitContainer(
    "download-voices",
    "ghcr.io/benfiola/homelab-images/toolbox:1.1.0",
    {
      args: [
        "bash",
        "/scripts/download-voices.sh",
        assetsServer.url(),
        "/data",
        files.onnx,
        files.json,
      ],
      volumeMounts: {
        voices: "/data",
        scripts: "/scripts",
      },
    },
  );

  deployment.addContainer(
    "wyoming-piper",
    "docker.io/rhasspy/wyoming-piper:2.4.2",
    {
      args: [
        `--voice=${modelName}`,
        "--uri=tcp://0.0.0.0:10200",
        "--data-dir=/data",
        "--use-cuda",
      ],
      containerPorts: { wyoming: 10200 },
      resources: {
        limits: {
          "nvidia.com/gpu": "1",
        },
        requests: {
          "nvidia.com/gpu": "1",
        },
      },
      volumeMounts: {
        voices: "/data",
      },
    },
  );

  deployment.createService({ wyoming: 10200 });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
