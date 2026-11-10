import type { AppFunction } from "../../tools/lib/app.ts";
import {
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  const ns = h.namespace();

  const secrets = ns.secrets("secrets", [
    "frigate-password",
    "home-assistant-password",
  ]);

  const config = ns.configMap(
    "mosquitto-config",
    h.files("mosquitto.conf", "acl.conf"),
  );
  const scripts = ns.configMap("mosquitto-scripts", h.files("setup-auth.sh"));

  const workload = ns
    .statefulSet("mosquitto", {
      volumes: {
        auth: { ephemeral: { size: "1Gi" } },
        config: { configMap: config.metadata.name },
        scripts: { configMap: scripts.metadata.name },
        data: { pvc: { size: "10Gi", storageClass: "replicated" } },
      },
    })
    .addInitContainer("setup-auth", {
      image: "docker.io/eclipse-mosquitto:2.1.2-alpine",
      args: ["sh", "/scripts/setup-auth.sh"],
      volumeMounts: {
        scripts: "/scripts",
        auth: "/auth",
      },
      env: {
        PASSWORD_FRIGATE: secrets.key("frigate-password"),
        PASSWORD_HOME_ASSISTANT: secrets.key("home-assistant-password"),
      },
    })
    .addContainer("mosquitto", {
      image: "docker.io/eclipse-mosquitto:2.1.2-alpine",
      containerPorts: {
        web: [1883, "TCP"],
      },
      volumeMounts: {
        config: "/mosquitto/config",
        data: "/mosquitto/data",
        auth: "/auth",
      },
      env: {
        MOSQUITTO_UNSAFE_ALLOW_SYMLINKS: "",
      },
      ...h.probes({ tcp: { port: 1883 } }, { startup: false }),
    });

  workload.service({ db: 1883 });
  ns.vpa(workload);
};

export const network: NetworkFunction = (n) => {
  const mosquitto = n.subject("mosquitto", pod("mosquitto", "mosquitto"));

  n.host.to(mosquitto, tcp(1883));
};
