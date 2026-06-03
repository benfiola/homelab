import dedent from "ts-dedent";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  Namespace,
  StatefulSet,
  VaultAuth,
  VaultStaticSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id);

  new Namespace(chart);

  const vaultAuth = new VaultAuth(chart);

  const vaultSecret = new VaultStaticSecret(chart, vaultAuth);

  const config = new ConfigMap(chart, `${id}-config-map-config`, {
    metadata: {
      name: "mosquitto-config",
    },
    data: {
      "mosquitto.conf": dedent`
        listener 1883
        plugin /usr/lib/mosquitto_persist_sqlite.so
        persistence_location /mosquitto/data/
        plugin /usr/lib/mosquitto_password_file.so
        plugin_opt_password_file /auth/password_file
        acl_file /mosquitto/config/acl.conf
      `,
      "acl.conf": dedent`
        user home-assistant
        topic readwrite #
        user frigate
        topic readwrite frigate/#
      `,
    },
  });

  const scripts = new ConfigMap(chart, `${id}-config-map-scripts`, {
    metadata: {
      name: "mosquitto-scripts",
    },
    data: {
      "setup-auth.sh": dedent`
        #!/bin/sh
        set -e
        touch /auth/password_file
        chmod 0700 /auth/password_file
        /usr/bin/mosquitto_passwd -b /auth/password_file home-assistant "\${PASSWORD_HOME_ASSISTANT}"
        /usr/bin/mosquitto_passwd -b /auth/password_file frigate "\${PASSWORD_FRIGATE}"
      `,
    },
  });

  const statefulSet = new StatefulSet(chart, "mosquitto", {
    volumes: {
      auth: { emptyDir: {} },
      config: { configMap: config.name },
      scripts: { configMap: scripts.name },
      data: { pvc: { size: "10Gi", storageClass: "replicated" } },
    },
  });
  statefulSet.addInitContainer(
    "setup-auth",
    "docker.io/eclipse-mosquitto:2.1.2-alpine",
    {
      args: ["sh", "/scripts/setup-auth.sh"],
      volumeMounts: {
        scripts: "/scripts",
        auth: "/auth",
      },
      env: {
        PASSWORD_FRIGATE: {
          secretKeyRef: { name: vaultSecret.name, key: "frigate-password" },
        },
        PASSWORD_HOME_ASSISTANT: {
          secretKeyRef: {
            name: vaultSecret.name,
            key: "home-assistant-password",
          },
        },
      },
    },
  );
  statefulSet.addContainer(
    "mosquitto",
    "docker.io/eclipse-mosquitto:2.1.2-alpine",
    {
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
    },
  );

  statefulSet.createService({ db: 1883 });

  new VerticalPodAutoscaler(chart, statefulSet);

  return chart;
};
