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

  const deployment = new Deployment(chart, "wyoming-openai");

  deployment.addContainer(
    "wyoming-openai",
    "ghcr.io/roryeckel/wyoming_openai:0.5.0",
    {
      env: {
        WYOMING_URI: "tcp://0.0.0.0:10300",
        WYOMING_LOG_LEVEL: "INFO",
        WYOMING_LANGUAGES: "en",
        TTS_OPENAI_URL: "http://kokoro-fastapi.kokoro-fastapi.svc:8880/v1",
        TTS_MODELS: "kokoro",
        TTS_BACKEND: "KOKORO_FASTAPI",
      },
      containerPorts: { wyoming: 10300 },
    },
  );

  deployment.createService({ wyoming: 10300 });

  new VerticalPodAutoscaler(chart, deployment);

  return chart;
};
