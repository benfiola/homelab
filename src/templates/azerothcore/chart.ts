import { readFile } from "fs/promises";
import { join } from "path";
import { ConfigMap } from "../../../assets/kubernetes/k8s";
import {
  Chart,
  Namespace,
  StatefulSet,
  TcpRoute,
  VerticalPodAutoscaler,
  getAssetsServerUrl,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, _, context) => {
  const id = context.name;
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const hostname = "wow.bulia.dev";
  const dbHost = "mariadb.azerothcore.svc";
  const dbPort = 3306;

  const migrationScript = join(__dirname, "db-migration.sh");
  const downloadScript = join(__dirname, "download-game-data.sh");

  new ConfigMap(chart, "scripts-config", {
    metadata: { name: "azerothcore-scripts" },
    data: {
      "download-game-data.sh": (await readFile(downloadScript)).toString(),
      "db-migration.sh": (await readFile(migrationScript)).toString(),
    },
  });

  const mariadbSs = new StatefulSet(chart, "mariadb", {
    volumes: {
      "mariadb-data": {
        pvc: { size: "100Gi", storageClass: "replicated" },
      },
    },
  });

  mariadbSs.addContainer("mariadb", "mariadb:10.11", {
    containerPorts: { db: 3306 },
    env: {
      MARIADB_ROOT_PASSWORD: "azeroth-root-password",
      MARIADB_AUTO_UPGRADE: "1",
    },
    volumeMounts: {
      "mariadb-data": "/var/lib/mysql",
    },
  });

  mariadbSs.createService({ db: 3306 });

  const azerothSs = new StatefulSet(chart, "azerothcore", {
    securityContext: { uid: 1000, gid: 1000 },
    volumes: {
      "game-data": {
        pvc: { size: "100Gi", storageClass: "standard" },
      },
      logs: {
        pvc: { size: "10Gi", storageClass: "standard" },
      },
      scripts: {
        configMap: "azerothcore-scripts",
      },
    },
  });

  azerothSs.addInitContainer(
    "download-game-data",
    "ghcr.io/benfiola/homelab-images/toolbox:1.0.0",
    {
      cmd: ["sh"],
      args: ["/scripts/download-game-data.sh"],
      env: {
        GAME_DATA_URL: getAssetsServerUrl("azerothcore/game-data-v19.zip"),
      },
      volumeMounts: {
        "game-data": "/game-data",
        scripts: "/scripts",
      },
    },
  );

  azerothSs.addInitContainer(
    "db-migration",
    "acore/ac-wotlk-db-import:master",
    {
      env: {
        AC_LOGIN_DATABASE_INFO: `${dbHost};${dbPort};root;azeroth-root-password;acore_auth`,
        AC_WORLD_DATABASE_INFO: `${dbHost};${dbPort};root;azeroth-root-password;acore_world`,
        AC_CHARACTER_DATABASE_INFO: `${dbHost};${dbPort};root;azeroth-root-password;acore_characters`,
        AC_DATA_DIR: "/game-data",
        AC_LOGS_DIR: "/logs",
      },
      args: ["bash", "/scripts/db-migration.sh"],
      volumeMounts: {
        "game-data": "/game-data",
        logs: "/logs",
        scripts: "/scripts",
      },
    },
  );

  azerothSs.addContainer("authserver", "acore/ac-wotlk-authserver:master", {
    containerPorts: { auth: 3724 },
    env: {
      AC_LOGIN_DATABASE_INFO: `${dbHost};${dbPort};root;azeroth-root-password;acore_auth`,
      AC_LOGS_DIR: "/logs",
      AC_TEMP_DIR: "/tmp",
      AC_DISABLE_INTERACTIVE: "1",
    },
    volumeMounts: {
      logs: "/logs",
    },
  });

  azerothSs.addContainer("worldserver", "acore/ac-wotlk-worldserver:master", {
    containerPorts: {
      world: 8085,
      soap: 7878,
    },
    env: {
      AC_WORLD_DATABASE_INFO: `${dbHost};${dbPort};root;azeroth-root-password;acore_world`,
      AC_CHARACTER_DATABASE_INFO: `${dbHost};${dbPort};root;azeroth-root-password;acore_characters`,
      AC_DATA_DIR: "/game-data",
      AC_LOGS_DIR: "/logs",
      AC_DISABLE_INTERACTIVE: "1",
    },
    volumeMounts: {
      "game-data": "/game-data",
      logs: "/logs",
    },
  });

  const svc = azerothSs.createService({
    auth: 3724,
    world: 8085,
    soap: 7878,
  });

  new VerticalPodAutoscaler(chart, azerothSs);
  new VerticalPodAutoscaler(chart, mariadbSs);

  new TcpRoute(chart, "users", hostname, 3724, svc, 3724);
  new TcpRoute(chart, "users", hostname, 8085, svc, 8085);
  new TcpRoute(chart, "users", hostname, 7878, svc, 7878);

  return chart;
};
