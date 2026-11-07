import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  const secrets = h.secrets("secrets", ["hass-token"]);

  const workload = h
    .deployment("wyoming-whisper", {
      volumes: {
        cache: { ephemeral: { size: "1Gi" } },
        data: { ephemeral: { size: "5Gi" } },
      },
    })
    .addContainer("wyoming-whisper", {
      image: "ghcr.io/benfiola/homelab-images/wyoming-whisper:1.1.3",
      args: [
        "--hass-token=$(HASS_TOKEN)",
        "--hass-api=http://home-assistant.home-assistant.svc:8123/api",
        "--model=large-v3-turbo",
        "--language=en",
        "--uri=tcp://0.0.0.0:10300",
        "--data-dir=/data",
        "--device=cuda",
      ],
      containerPorts: { wyoming: 10300 },
      env: {
        HASS_TOKEN: secrets.key("hass-token"),
      },
      resources: {
        limits: { "nvidia.com/gpu": "1" },
        requests: { "nvidia.com/gpu": "1" },
      },
      volumeMounts: {
        cache: "/nonexistent/.cache",
        data: "/data",
      },
    });

  workload.service({ wyoming: 10300 });
  h.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const wyomingWhisper = n.subject(
    "wyoming-whisper",
    pod("wyoming-whisper", "wyoming-whisper"),
  );

  wyomingWhisper
    .to(n.ref("home-assistant"), tcp(8123))
    .to(dns("us.aws.cdn.hf.co"), tcp(443))
    .to(dns("cas-server.xethub.hf.co"), tcp(443))
    .to(dns("huggingface.co"), tcp(443));
};
