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

  const image = "ghcr.io/benfiola/homelab-images/azerothcore:1.3.2";
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
          {
            username: "ahbot",
            password: secret("user-ahbot-password"),
            gm_level: 1,
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
    args: [
      // see: https://github.com/mod-playerbots/mod-playerbots/wiki/Installation-Guide#4-configure-playerbots
      "--skip-log-bin",
      "--innodb-buffer-pool-size=1G",
      "--innodb-io-capacity=200",
      "--innodb-io-capacity-max=1000",
      "--transaction-isolation=READ-COMMITTED",
    ],
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
    args: ["authserver"],
    containerPorts: { auth: 3724 },
    env: {
      AC_LOGIN_DATABASE_INFO: {
        secretKeyRef: { name: secrets.name, key: "db-info-login" },
      },
      AC_DISABLE_INTERACTIVE: "1",
    },
  });

  serverStatefulSet.addContainer("worldserver", image, {
    args: ["worldserver"],
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

      // see: https://www.azerothcore.org/wiki/config-overrides-with-env-var
      // see: https://github.com/mod-playerbots/mod-playerbots/wiki/Playerbot-Configuration#recommended-config
      AC_AIPLAYERBOT_GUILD_FEEDBACK: "0",
      AC_AI_PLAYERBOT_AUTO_GEAR_QUALITY_LIMIT: "4",
      AC_AI_PLAYERBOT_CONTACT_DISTANCE: "0.5",
      AC_AI_PLAYERBOT_DISABLED_WITHOUT_REAL_PLAYER: "1",
      AC_AI_PLAYERBOT_ENABLE_BROADCASTS: "0",
      AC_AI_PLAYERBOT_FLEE_DISTANCE: "8.0",
      AC_AI_PLAYERBOT_GUILD_REPLIES_RATE: "0",
      AC_AI_PLAYERBOT_LOOT_DISTANCE: "25.0",
      AC_AI_PLAYERBOT_MAX_RANDOM_BOT_IN_WORLD_TIME: "1209600",
      AC_AI_PLAYERBOT_MELEE_DISTANCE: "1.5",
      AC_AI_PLAYERBOT_MIN_RANDOM_BOT_IN_WORLD_TIME: "3600",
      AC_AI_PLAYERBOT_RANDOM_BOT_MAX_LEVEL_CHANCE: "0.01",
      AC_AI_PLAYERBOT_RANDOM_BOT_SUGGEST_DUNGEONS: "0",
      AC_AI_PLAYERBOT_RANDOM_BOT_TALK: "0",
      AC_AI_PLAYERBOT_SHOOT_DISTANCE: "26.0",
      AC_AI_PLAYERBOT_SIGHT_DISTANCE: "75.0",
      AC_AI_PLAYERBOT_THUNDERFURY_REPLIES_CHANCE: "0",
      AC_AI_PLAYERBOT_TOXIC_LINKS_REPLIES_CHANCE: "0",
      AC_AUCTION_HOUSE_BOT_GUIDS: "5002",
      AC_AUCTION_HOUSE_BOT_ENABLE_SELLER: "true",
      AC_CONSOLE_ENABLE: "0",
      AC_LEAVE_GROUP_ON_LOGOUT_ENABLED: "1",
      AC_MAP_UPDATE_THREADS: "4",
      AC_PLAYERBOTS_DATABASE_SYNCH_THREADS: "2",
      AC_PLAYER_LIMIT: "0",
      AC_QUESTS_IGNORE_AUTO_ACCEPT: "1",
    },
    volumeMounts: {
      data: "/data",
    },
  });

  const svc = serverStatefulSet.createService({
    auth: 3724,
    world: 8085,
    soap: 7878,
  });

  new VerticalPodAutoscaler(chart, serverStatefulSet);
  new VerticalPodAutoscaler(chart, dbStatefulSet);

  new TcpRoute(chart, "friends", hostname, 3724, svc, 3724);
  new TcpRoute(chart, "friends", hostname, 8085, svc, 8085);
  new TcpRoute(chart, "friends", hostname, 7878, svc, 7878);

  return chart;
};
