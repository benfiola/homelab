#!/usr/bin/env tsx
import { Command, program } from "commander";
import { createReadStream } from "fs";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import pino from "pino";
import { exit, stdin } from "process";
import * as actions from "./actions";
import { LogFormat, TransportOpts } from "./cli-logger.mts";
import { isSecret, Secret } from "./config";
import { logger, LogLevel, logLevels, LogStatus, setLogger } from "./logger";
import { randomString } from "./strings";
import { stringify } from "./yaml";

const status = (status: LogStatus, message: string) => {
  logger().status({ status }, message);
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
  if (!opts.dryRun) {
    status("work", "Applying system config...");
  }

  const systemConfigs = await actions.applySystemConfig(opts.configDir, {
    dryRun: opts.dryRun,
    insecure: opts.insecure,
    nodes: opts.nodes,
  });

  if (opts.dryRun) {
    console.log(stringify(...Object.values(systemConfigs)));
  } else {
    logger().debug(stringify(...Object.values(systemConfigs)));
    status("success", "Done");
  }
};

interface BootstrapOpts {
  configDir: string;
  manifestsDir: string;
}

const bootstrap = async (opts: BootstrapOpts) => {
  status("work", "Bootstrapping cluster...");
  await actions.bootstrap(opts.configDir, opts.manifestsDir, {
    ...opts,
    onStepStart: (step) => {
      if (step === "generate-manifests") {
        status("work", "Generating manifests...");
      } else if (step === "deploy-cilium") {
        status("work", "Deploying cilium...");
      } else if (step === "install-flux") {
        status("work", "Installing flux...");
      } else if (step === "pull-secrets") {
        status("work", "Pulling secrets...");
      } else if (step === "initialize-vault") {
        status("work", "Initializing vault...");
      } else if (step === "deploy-crds") {
        status("work", "Deploying CRDs...");
      } else if (step === "wait-for-cluster-ready") {
        status("work", "Waiting for cluster ready...");
      }
    },
  });
  status("success", "Done");
};

interface PushSecretOpts {
  configDir: string;
}

const pushSecret = async (secret: Secret, opts: PushSecretOpts) => {
  if (!isSecret(secret)) {
    throw new Error(`invalid secret: ${secret}`);
  }

  status("work", `Pushing '${secret}' secret...`);
  await actions.pushSecrets(secret, opts.configDir);
  status("success", "Done");
};

interface PullSecretsOpts {
  configDir: string;
}

const pullSecrets = async (opts: PullSecretsOpts) => {
  status("work", "Pulling secrets...");
  await actions.pullSecrets(opts.configDir);
  status("success", "Done");
};

interface GenerateClientConfigOpts {
  configDir: string;
  output: string;
}

const generateClientConfig = async (opts: GenerateClientConfigOpts) => {
  status("work", "Generating client config...");
  await actions.generateClientConfig(opts.configDir, opts.output);
  status("success", "Done");
};

interface GenerateManifestOpts {
  configDir: string;
  filter?: string[];
  output: string;
}

const generateManifests = async (opts: GenerateManifestOpts) => {
  status("work", "Generating manifests...");
  await actions.generateManifests(opts.configDir, opts.output, {
    filter: opts.filter,
  });
  status("success", "Done");
};

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

const refreshAssets = async (opts: RefreshAssetsOpts) => {
  status("work", "Refreshing assets...");
  await actions.refreshAssets(opts.output, { filter: opts.filter });
  status("success", "Done");
};

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
  // each call to `exec.ts/spawn` briefly attaches event listeners to `processs` to gracefully terminate shut down processes
  // during an async fanout (e.g., 'generate-manifests' or 'generate-libs'), the default max listeners limit (10) gets reached.
  process.setMaxListeners(30);

  const homeDir = homedir();
  const projectDir = join(__dirname, "..");
  const defaultConfigDir = join(projectDir, "config");
  const defaultLogFormat = "rich";
  const defaultLogLevel = "status";
  const defaultAssetsDir = join(projectDir, "assets");
  const defaultManifestsDir = join(projectDir, "manifests");
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
    .option("--nodes", "specific to apply configuration to")
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

  await program.parseAsync();
};

const handleError = async (error: any) => {
  const suffix = await randomString(8);
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
