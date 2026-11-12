import type { AppFunction } from "../../tools/lib/app.ts";
import {
  assetsServer,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  const assets = ns.assetsServer();

  const scripts = ns.configMap(
    "llama-cpp-llama-cpp-config-map-scripts",
    h.files("download-models.sh"),
  );

  const files = {
    model: "gemma-4-12b-it-UD-Q4_K_XL.gguf",
    mmproj: "mmproj-gemma-4-12b-it-F16.gguf",
    mtp: "mtp-gemma-4-12b-it-Q8_0.gguf",
  } as const;

  const workload = ns
    .statefulSet("llama-cpp", {
      securityContext: { uid: 1000, gid: 1000 },
      volumes: {
        data: { ephemeral: { size: "20Gi" } },
        scripts: { configMap: scripts.metadata.name },
      },
      nodeSelector: {
        "nvidia.com/gpu.present": "true",
      },
    })
    .addInitContainer("download-model", {
      image: h.images.toolbox,
      args: [
        "bash",
        "/scripts/download-models.sh",
        assets.url,
        "/data",
        files.model,
        files.mmproj,
        files.mtp,
      ],
      volumeMounts: {
        data: "/data",
        scripts: "/scripts",
      },
    })
    .addContainer("llama-cpp", {
      image: "ghcr.io/ggml-org/llama.cpp:server-cuda-b12211",
      containerPorts: { web: 8080 },
      args: [
        "--model",
        `/data/${files.model}`,
        "--mmproj",
        `/data/${files.mmproj}`,
        "--model-draft",
        `/data/${files.mtp}`,
        "--spec-type",
        "draft-mtp",
        "--spec-draft-n-max",
        "4",
        "--n-gpu-layers",
        "999",
        "--flash-attn",
        "on",
        "--jinja",
        "--metrics",
        "--cache-type-k",
        "q8_0",
        "--cache-type-v",
        "q8_0",
        "--ctx-size",
        "16384",
        "--parallel",
        "1",
        "--chat-template-kwargs",
        '{"enable_thinking":false}',
        "--host",
        "0.0.0.0",
        "--port",
        "8080",
      ],
      resources: {
        limits: { "nvidia.com/gpu": "1" },
        requests: { "nvidia.com/gpu": "1" },
      },
      volumeMounts: {
        data: "/data",
      },
      ...h.probes({ http: { path: "/health", port: 8080 } }),
    });

  workload.service({ web: 8080 });
  workload.podMonitor("web");
  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const llamaCppAssetsServer = n.subject(
    "llama-cpp-assets-server",
    assetsServer("llama-cpp"),
  );
  const llamaCppServer = n.subject("llama-cpp", pod("llama-cpp", "llama-cpp"));

  llamaCppServer.to(llamaCppAssetsServer, tcp(8080));
  n.host.to(llamaCppAssetsServer, tcp(8080)).to(llamaCppServer, tcp(8080));
  n.ref("prometheus").to(llamaCppServer, tcp(8080));
};
