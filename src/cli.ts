#!/usr/bin/env tsx
import { Command, program } from "commander";
import { createReadStream } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import pino from "pino";
import { exit, stdin } from "process";
import * as actions from "./actions";
import * as swos from "./swos";
import { LogFormat, TransportOpts } from "./cli-logger.mts";
import { isSecret, Secret } from "./config";
import { logger, LogLevel, logLevels, LogStatus, setLogger } from "./logger";
import { randomString } from "./strings";
import { stringify } from "./yaml";

const status = (status: LogStatus, message: string) => {
  logger().status({ status }, message);
};

const withStatus = async (message: string, fn: () => Promise<void>) => {
  status("work", message);
  await fn();
  status("success", "Done");
};

const analyzeHubbleFlows = async (input: string) => {
  const stream = input === "-" ? stdin : createReadStream(input);

  const getFlowDirectionString = (direction: actions.FlowDirection) => {
    if (direction === "egress") {
      return "→";
    } else if (direction === "ingress") {
      return "←";
    } else {
      return "UNKNOWN";
    }
  };

  const getFlowVerdictColor = (verdict: actions.FlowVerdict) => {
    let green = "\x1b[32m";
    let red = "\x1b[31m";
    let reset = "\x1b[0m";

    let color = verdict === "allowed" ? green : red;
    return [color, reset];
  };

  const getFlowSubjectString = (subject: actions.FlowSubject) => {
    if (subject.type === "health") {
      return "health";
    } else if (subject.type === "node") {
      return `node:${subject.name}`;
    } else if (subject.type === "host") {
      return "host";
    } else if (subject.type === "world") {
      return `world:${subject.value}`;
    } else if (subject.type === "pod") {
      const labels: string[] = [];
      if (subject.component) {
        labels.push(`c:${subject.component}`);
      }
      if (subject.gateway) {
        labels.push(`g:${subject.gateway}`);
      }
      if (subject.k8sApp) {
        labels.push(`ka:${subject.k8sApp}`);
      }
      if (subject.pod) {
        labels.push(`p:${subject.pod}`);
      }
      const namespace = subject.namespace;
      return `pod:${namespace}{${labels.join(", ")}}`;
    } else if (subject.type === "unknown") {
      return "unknown";
    } else {
      return "UNKNOWN";
    }
  };

  const getFlowProtocolString = (protocol: actions.FlowProtocol) => {
    if (protocol.type === "icmpv4" || protocol.type === "icmpv6") {
      return `${protocol.type}/${protocol.icmpType}`;
    } else if (protocol.type === "tcp" || protocol.type === "udp") {
      return `${protocol.type}/${protocol.port}`;
    } else {
      return "UNKNOWN";
    }
  };

  const onFlow = (flow: actions.Flow) => {
    const [color, reset] = getFlowVerdictColor(flow.verdict);

    const direction = getFlowDirectionString(flow.direction);
    const source = getFlowSubjectString(flow.source);
    const destination = getFlowSubjectString(flow.destination);
    const protocol = getFlowProtocolString(flow.port);
    const policy = flow.policy || "unknown";

    console.log(
      `${color}${direction} ${source} ⟶ ${destination} (${protocol}) [${policy}] ${reset}`,
    );
  };

  await actions.analyzeHubbleFlows(stream, {
    onFlow,
  });
};

interface ApplySystemConfigOpts {
  configDir: string;
  dryRun: boolean;
  insecure: boolean;
  nodes: string[];
}

const applySystemConfig = async (opts: ApplySystemConfigOpts) => {
  if (opts.dryRun) {
    const systemConfigs = await actions.applySystemConfig(opts.configDir, {
      dryRun: true,
      insecure: opts.insecure,
      nodes: opts.nodes,
    });
    console.log(stringify(...Object.values(systemConfigs)));
    return;
  }

  await withStatus("Applying system config...", async () => {
    const systemConfigs = await actions.applySystemConfig(opts.configDir, {
      dryRun: false,
      insecure: opts.insecure,
      nodes: opts.nodes,
    });
    logger().debug(stringify(...Object.values(systemConfigs)));
  });
};

interface BootstrapOpts {
  configDir: string;
  manifestsDir: string;
}

const bootstrap = (opts: BootstrapOpts) =>
  withStatus("Bootstrapping cluster...", () =>
    actions.bootstrap(opts.configDir, opts.manifestsDir, {
      ...opts,
      onStepStart: (step) => {
        const messages: Record<string, string> = {
          "generate-manifests": "Generating manifests...",
          "deploy-cilium": "Deploying cilium...",
          "install-flux": "Installing flux...",
          "pull-secrets": "Pulling secrets...",
          "initialize-vault": "Initializing vault...",
          "deploy-crds": "Deploying CRDs...",
          "wait-for-cluster-ready": "Waiting for cluster ready...",
        };
        const msg = messages[step];
        if (msg) status("work", msg);
      },
    }),
  );

interface PushSecretOpts {
  configDir: string;
}

const pushSecret = (secret: Secret, opts: PushSecretOpts) => {
  if (!isSecret(secret)) {
    throw new Error(`invalid secret: ${secret}`);
  }
  return withStatus(`Pushing '${secret}' secret...`, () =>
    actions.pushSecrets(secret, opts.configDir),
  );
};

interface PullSecretsOpts {
  configDir: string;
}

const pullSecrets = (opts: PullSecretsOpts) =>
  withStatus("Pulling secrets...", () => actions.pullSecrets(opts.configDir));

interface GenerateClientConfigOpts {
  configDir: string;
  output: string;
}

const generateClientConfig = (opts: GenerateClientConfigOpts) =>
  withStatus("Generating client config...", () =>
    actions.generateClientConfig(opts.configDir, opts.output),
  );

interface GenerateManifestOpts {
  configDir: string;
  filter?: string[];
  output: string;
}

const generateManifests = (opts: GenerateManifestOpts) =>
  withStatus("Generating manifests...", () =>
    actions.generateManifests(opts.configDir, opts.output, {
      filter: opts.filter,
    }),
  );

interface GenerateNetworkConfigOpts {
  configDir: string;
  filter?: string[];
  output: string;
}

const generateNetworkConfig = (opts: GenerateNetworkConfigOpts) =>
  withStatus("Generating network configuration...", () =>
    actions.generateNetworkConfig(opts.configDir, opts.output, {
      filter: opts.filter,
    }),
  );

interface GenerateTalosImagesOpts {
  configDir: string;
}

const generateTalosImages = async (
  version: string,
  opts: GenerateTalosImagesOpts,
) => {
  const images = await actions.generateTalosImages(opts.configDir, version);

  const hws = Object.keys(images);
  hws.sort();
  for (const hw of hws) {
    const image = images[hw];
    console.log(hw);
    console.log(`  raw: ${image.raw}`);
    console.log(`  oci: ${image.oci}`);
  }
};

interface RefreshAssetsOpts {
  filter: string[];
  output: string;
}

const refreshAssets = (opts: RefreshAssetsOpts) =>
  withStatus("Refreshing assets...", () =>
    actions.refreshAssets(opts.output, { filter: opts.filter }),
  );

interface TalosctlOpts {
  configDir: string;
}

const talosctl = async (opts: TalosctlOpts, command: Command) => {
  await actions.talosctl(opts.configDir, command.args);
};

interface UpgradeTalosOpts {
  configDir: string;
  nodes?: string[];
}

const upgradeTalos = async (opts: UpgradeTalosOpts) => {
  await actions.upgradeTalos(opts.configDir, { nodes: opts.nodes });
};

const configureLogger = async (logFormat: LogFormat, logLevel: LogLevel) => {
  const loggerOpts: pino.LoggerOptions<LogLevel> = {
    level: logLevel,
    customLevels: logLevels,
    useOnlyCustomLevels: true,
  };

  const transportOpts: TransportOpts = {
    format: logFormat,
  };

  loggerOpts.transport = {
    target: "./cli-logger.mts",
    options: transportOpts,
  };

  setLogger(pino(loggerOpts));
};

const main = async () => {
  const homeDir = homedir();
  const projectDir = join(__dirname, "..");
  const defaultConfigDir = join(projectDir, "config");
  const defaultLogFormat = "rich";
  const defaultLogLevel = "status";
  const defaultAssetsDir = join(projectDir, "assets");
  const defaultManifestsDir = join(projectDir, "manifests");
  const defaultNetworkConfigDir = join(projectDir, "network-config");
  const defaultTalosconfigPath = join(homeDir, ".talos", "config");

  program.description("homelab administration cli").enablePositionalOptions();

  program
    .option("--log-format <format>", "log format", defaultLogFormat)
    .option("--log-level <level>", "log level", defaultLogLevel)
    .hook("preAction", async (command) => {
      const options = command.optsWithGlobals();
      configureLogger(options.logFormat, options.logLevel);
    });

  program
    .command("analyze-hubble-flows [input]")
    .description("analyzes a JSON-based hubble flow stream")
    .action(analyzeHubbleFlows);

  program
    .command("apply-system-config")
    .description("applies talos machine/volume configurations to all nodes")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .option("--dry-run", "prints the system config", false)
    .option("--nodes [nodes...]", "specific to apply configuration to")
    .option("--insecure", "apply config using talos maintenance service", false)
    .action(applySystemConfig);

  program
    .command("bootstrap")
    .description("bootstraps a new cluster")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .option(
      "--manifests-dir <path>",
      "cluster manifests directory",
      defaultManifestsDir,
    )
    .action(bootstrap);

  program
    .command("generate-client-config")
    .description("generates a talosconfig file")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .option(
      "--output <path>",
      "generated client config path",
      defaultTalosconfigPath,
    )
    .action(generateClientConfig);

  program
    .command("generate-manifests")
    .description("generates kubernetes manifests for apps")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .option("--filter [apps...]", "filter generated manifests", [])
    .option("--output <path>", "generated manifests path", defaultManifestsDir)
    .action(generateManifests);

  program
    .command("generate-network-config")
    .description("generates configuration for networking devices")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .option("--filter [apps...]", "filter generated manifests", [])
    .option("--output <path>", "generated config path", defaultNetworkConfigDir)
    .action(generateNetworkConfig);

  program
    .command("generate-talos-images [version]")
    .description(
      "generates talos linux images for each configured hardware type",
    )
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .action(generateTalosImages);

  program
    .command("pull-secrets")
    .description("pulls secrets from remote storage")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .action(pullSecrets);

  program
    .command("push-secret [secret]")
    .description("pushes secret to remote storage")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .action(pushSecret);

  program
    .command("refresh-assets")
    .description("refreshes assets used to generate manifests")
    .option("--filter [templates...]", "filter templates", [])
    .option("--output <path>", "refreshed assets path", defaultAssetsDir)
    .action(refreshAssets);

  program
    .command("talosctl")
    .description("invoke talos commands directly")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .allowExcessArguments()
    .allowUnknownOption()
    .passThroughOptions()
    .action(talosctl);

  program
    .command("upgrade-talos")
    .description("upgrades talos on all nodes")
    .option("--config-dir <path>", "cluster config directory", defaultConfigDir)
    .action(upgradeTalos);

  program
    .command("apply-swos <config>")
    .description("applies a SwOS switch configuration from a YAML file")
    .requiredOption("--address <ip>", "switch IP address")
    .option("--username <name>", "switch username", "admin")
    .option("--password <secret>", "switch password", "")
    .option("--dry-run", "show what would change without writing", false)
    .action(
      async (
        config: string,
        opts: {
          address: string;
          username: string;
          password: string;
          dryRun: boolean;
        },
      ) => {
        await swos.applyConfig(
          config,
          opts.address,
          opts.username,
          opts.password,
          opts.dryRun,
        );
      },
    );

  program
    .command("dump-swos <address>")
    .description("dumps current SwOS switch configuration as YAML")
    .option("--username <name>", "switch username", "admin")
    .option("--password <secret>", "switch password", "")
    .action(
      async (
        address: string,
        opts: { username: string; password: string },
      ) => {
        await swos.dumpConfig(address, opts.username, opts.password);
      },
    );

  await program.parseAsync();
};

const handleError = async (error: any) => {
  const suffix = randomString(8);
  const file = join("/tmp", `homelab-error.${suffix}.json`);
  await writeFile(file, JSON.stringify(error, null, 2));

  let message = (error as any)?.message;
  if (message === undefined) {
    message = "an unknown error occurred";
  }
  message = `${message} (more details in ${file})`;

  logger().error(message);
};

(async function () {
  let code = 0;
  try {
    await main();
  } catch (error) {
    await handleError(error);
    code = 1;
  }
  exit(code);
})();
