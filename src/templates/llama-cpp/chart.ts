import { readFile } from "fs/promises";
import path from "path";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  AssetsServer,
  BucketSyncAuth,
  Chart,
  Namespace,
  StatefulSet,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });
  new Namespace(chart);

  const bucketSyncAuth = new BucketSyncAuth(chart);
  const assetsServer = new AssetsServer(chart, bucketSyncAuth);

  const models: Record<string, string> = {
    [assetsServer.url("Qwen3VL-4B-Instruct-Q4_K_M.gguf")]: "/data/model.gguf",
    [assetsServer.url("mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf")]:
      "/data/vision.gguf",
  };

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    data: {
      "download-models.sh": (
        await readFile(path.join(__dirname, "download-models.sh"))
      ).toString(),
    },
  });

  const ss = new StatefulSet(chart, "llama-cpp", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      data: {
        pvc: { size: "10Gi", storageClass: "standard" },
      },
      scripts: { configMap: scripts.name },
    },
    nodeSelector: {
      "nvidia.com/gpu.present": "true",
    },
  });
  ss.addInitContainer(
    "download-model",
    "ghcr.io/benfiola/homelab-images/toolbox:1.1.0",
    {
      cmd: ["bash"],
      args: ["/scripts/download-models.sh", ...Object.entries(models).flat()],
      volumeMounts: {
        data: "/data",
        scripts: "/scripts",
      },
    },
  );
  ss.addContainer(
    "llama-cpp",
    "ghcr.io/ggml-org/llama.cpp:server-cuda-b10236",
    {
      containerPorts: { web: 8080 },
      args: [
        "-m",
        "/data/model.gguf",
        "--mmproj",
        "/data/vision.gguf",
        "-ngl",
        "99",
        "--ctx-size",
        "16384",
        "--host",
        "0.0.0.0",
        "--port",
        "8080",
      ],
      resources: {
        limits: {
          "nvidia.com/gpu": "1",
        },
        requests: {
          "nvidia.com/gpu": "1",
        },
      },
      volumeMounts: {
        data: "/data",
      },
    },
  );
  ss.createService({ web: 8080 });

  new VerticalPodAutoscaler(chart, ss);

  return chart;
};
