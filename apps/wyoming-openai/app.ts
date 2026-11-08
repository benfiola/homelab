import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.namespace();

  const workload = h
    .deployment("wyoming-openai")
    .addContainer("wyoming-openai", {
      image: "ghcr.io/roryeckel/wyoming_openai:0.9.0",
      env: {
        WYOMING_URI: "tcp://0.0.0.0:10300",
        WYOMING_LOG_LEVEL: "INFO",
        WYOMING_LANGUAGES: "en",
        TTS_OPENAI_URL: "http://kokoro-fastapi.kokoro-fastapi.svc:8880/v1",
        TTS_MODELS: "kokoro",
        TTS_BACKEND: "KOKORO_FASTAPI",
      },
      containerPorts: { wyoming: 10300 },
      ...h.probes({ tcp: { port: 10300 } }),
    });

  workload.service({ wyoming: 10300 });
  h.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const wyomingOpenai = n.subject(
    "wyoming-openai",
    pod("wyoming-openai", "wyoming-openai"),
  );

  wyomingOpenai.to(n.ref("kokoro-fastapi"), tcp(8880));
  n.host.to(wyomingOpenai, tcp(10300));
};
