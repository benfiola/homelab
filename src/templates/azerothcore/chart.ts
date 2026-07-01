import {
  Chart,
  getAssetsServerUrl,
  Namespace,
  StatefulSet,
  TcpRoute,
  VaultAuth,
  VaultDynamicSecret,
  VerticalPodAutoscaler,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { options, stringify } from "../../yaml";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const image = "ghcr.io/benfiola/homelab-images/azerothcore:1.1.5";
  const hostname = "wow.bulia.dev";
  const dbHost = "db.azerothcore.svc";
  const dbPort = 3306;

  const vaultAuth = new VaultAuth(chart);
  const secrets = new VaultDynamicSecret(chart, vaultAuth, (secret) => ({
    "db-password": secret("db-password"),
    "db-info-login": `${dbHost};${dbPort};root;${secret("db-password")};acore_auth`,
    "db-info-world": `${dbHost};${dbPort};root;${secret("db-password")};acore_world`,
    "db-info-characters": `${dbHost};${dbPort};root;${secret("db-password")};acore_characters`,
    "db-info-playerbots": `${dbHost};${dbPort};root;${secret("db-password")};acore_playerbots`,
    "config.yaml": stringify(
      options({ schema: "core", defaultStringType: "QUOTE_SINGLE" }),
      {
        accounts: [
          {
            username: "bfiola",
            password: secret("user-bfiola-password"),
            gm_level: 3,
          },
        ],
      },
    ),
  }));

  const dbStatefulSet = new StatefulSet(chart, "db", {
    volumes: {
      "db-data": {
        pvc: { size: "100Gi", storageClass: "replicated" },
      },
    },
  });

  dbStatefulSet.addContainer("db", "mysql:8.4.10", {
    containerPorts: { db: 3306 },
    env: {
      MYSQL_ROOT_PASSWORD: {
        secretKeyRef: { name: secrets.name, key: "db-password" },
      },
    },
    volumeMounts: {
      "db-data": "/var/lib/mysql",
    },
  });

  dbStatefulSet.createService({ db: 3306 });

  const serverStatefulSet = new StatefulSet(chart, "server", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      data: {
        pvc: { size: "100Gi", storageClass: "standard" },
      },
      config: {
        secret: secrets.name,
        items: [{ key: "config.yaml" }],
      },
    },
  });

  serverStatefulSet.addInitContainer("init", image, {
    env: {
      AC_GAME_DATA_URL: getAssetsServerUrl("azerothcore/game-data-v19.zip"),
      AC_LOGIN_DATABASE_INFO: {
        secretKeyRef: { name: secrets.name, key: "db-info-login" },
      },
      AC_WORLD_DATABASE_INFO: {
        secretKeyRef: { name: secrets.name, key: "db-info-world" },
      },
      AC_CHARACTER_DATABASE_INFO: {
        secretKeyRef: { name: secrets.name, key: "db-info-characters" },
      },
      AC_PLAYERBOTS_DATABASE_INFO: {
        secretKeyRef: { name: secrets.name, key: "db-info-playerbots" },
      },
      AC_REALMLIST_ADDRESS: "wow.bulia.dev",
    },
    args: ["init"],
    volumeMounts: {
      data: "/data",
      config: "/config",
    },
  });

  serverStatefulSet.addContainer("authserver", image, {
    containerPorts: { auth: 3724 },
    env: {
      AC_LOGIN_DATABASE_INFO: {
        secretKeyRef: { name: secrets.name, key: "db-info-login" },
      },
      AC_DISABLE_INTERACTIVE: "1",
    },
  });

  serverStatefulSet.addContainer(
    "worldserver",
    "acore/ac-wotlk-worldserver:master",
    {
      containerPorts: {
        world: 8085,
        soap: 7878,
      },
      env: {
        AC_LOGIN_DATABASE_INFO: {
          secretKeyRef: { name: secrets.name, key: "db-info-login" },
        },
        AC_WORLD_DATABASE_INFO: {
          secretKeyRef: { name: secrets.name, key: "db-info-world" },
        },
        AC_CHARACTER_DATABASE_INFO: {
          secretKeyRef: { name: secrets.name, key: "db-info-characters" },
        },
        AC_PLAYERBOTS_DATABASE_INFO: {
          secretKeyRef: { name: secrets.name, key: "db-info-playerbots" },
        },
        AC_DISABLE_INTERACTIVE: "1",
        AC_CONSOLE_ENABLE: "0",
      },
      volumeMounts: {
        data: "/data",
      },
    },
  );

  const svc = serverStatefulSet.createService({
    auth: 3724,
    world: 8085,
    soap: 7878,
  });

  new VerticalPodAutoscaler(chart, serverStatefulSet);
  new VerticalPodAutoscaler(chart, dbStatefulSet);

  new TcpRoute(chart, "users", hostname, 3724, svc, 3724);
  new TcpRoute(chart, "users", hostname, 8085, svc, 8085);
  new TcpRoute(chart, "users", hostname, 7878, svc, 7878);

  return chart;
};
