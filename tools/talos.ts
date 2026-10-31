#!/usr/bin/env node
import { Command, Option } from "commander";
import { stringify } from "yaml";
import { run } from "./lib/cli.ts";
import { secretsFile } from "./lib/secrets/local.ts";
import { loadTalos, type Node, type Talos } from "./lib/talos/config.ts";
import { translateArguments } from "./lib/talos/ctl.ts";
import { machineConfig } from "./lib/talos/machine.ts";
import {
  applyConfig,
  createSchematic,
  generateClientConfig,
  generateNodeConfig,
  talosctl,
  toYaml,
} from "./lib/talos/talosctl.ts";

const pick = (talos: Talos, names: string[]): Node[] => {
  if (names.length === 0) {
    return talos.nodes.filter((n) => n.enabled);
  }
  return names.map((name) => {
    const node = talos.nodes.find((n) => n.name === name);
    if (!node) {
      throw new Error(
        `no node '${name}' (have: ${talos.nodes.map((n) => n.name).join(", ")})`,
      );
    }
    return node;
  });
};

// every node's configuration, by node name
export const render = async (talos: Talos, nodes: Node[], secrets: string) => {
  const configs: Record<string, Record<string, any>[]> = {};
  await Promise.all(
    nodes.map(async (node) => {
      const generated = await generateNodeConfig(
        talos,
        node,
        talos.profiles[node.profile],
        secrets,
      );
      configs[node.name] = machineConfig(talos, node, generated);
    }),
  );
  return configs;
};

const dir = () =>
  new Option("--dir <dir>", "talos configuration").default("talos");

const secrets = () =>
  new Option(
    "--secrets <file>",
    "the cluster's secrets bundle (default: ~/.homelab/talos.yaml; see `talosctl gen secrets`)",
  ).env("TALOS_SECRETS");

// checked before anything else is done, as a mistake here is the commonest
const bundle = (given: string | undefined): string => {
  const file = secretsFile(given, "talos");
  if (!file) {
    throw new Error(
      "no secrets bundle: run `just secrets pull`, or give --secrets <file>",
    );
  }
  return file;
};

const program = new Command()
  .name("talos")
  .description(
    "the cluster's nodes: their machine configuration, and talosctl. secrets are never kept in this repository.",
  )
  .enablePositionalOptions()
  .showHelpAfterError();

program
  .command("config")
  .description("print the machine configuration of nodes")
  .argument("[node...]", "the nodes (default: all enabled)")
  .addOption(dir())
  .addOption(secrets())
  .action(async (names: string[], o: { dir: string; secrets?: string }) => {
    const file = bundle(o.secrets);
    const talos = loadTalos(o.dir);
    const nodes = pick(talos, names);
    const configs = await render(talos, nodes, file);
    for (const node of nodes) {
      if (nodes.length > 1) {
        console.log(`# node: ${node.name}`);
      }
      console.log(toYaml(configs[node.name]));
    }
  });

program
  .command("apply")
  .description("apply the machine configuration to nodes")
  .argument("[node...]", "the nodes (default: all enabled)")
  .addOption(dir())
  .addOption(secrets())
  .option(
    "--insecure",
    "connect without authenticating, for nodes still in maintenance mode",
  )
  .action(
    async (
      names: string[],
      o: { dir: string; secrets?: string; insecure?: boolean },
    ) => {
      const file = bundle(o.secrets);
      const talos = loadTalos(o.dir);
      const nodes = pick(talos, names);
      const configs = await render(talos, nodes, file);
      for (const node of nodes) {
        console.error(`applying configuration to ${node.name}...`);
        await applyConfig(node, configs[node.name], {
          insecure: o.insecure || undefined,
        });
      }
    },
  );

program
  .command("client-config")
  .description("print the talosconfig for the cluster")
  .addOption(dir())
  .addOption(secrets())
  .action(async (o: { dir: string; secrets?: string }) => {
    const file = bundle(o.secrets);
    console.log(
      stringify(await generateClientConfig(loadTalos(o.dir), file), {
        lineWidth: 0,
      }),
    );
  });

program
  .command("images")
  .description(
    "register the profiles' images with the image factory, and print them",
  )
  .argument("<version>", "the talos version, e.g. 1.14.4")
  .addOption(dir())
  .action(async (version: string, o: { dir: string }) => {
    const images: Record<string, { installer: string; image: string }> = {};
    for (const profile of Object.values(loadTalos(o.dir).profiles)) {
      const id = await createSchematic(profile.imageConfig.schematic);
      images[profile.name] = {
        installer: `factory.talos.dev/metal-installer/${id}:v${version}`,
        image: `https://factory.talos.dev/image/${id}/v${version}/${profile.imageConfig.filename}`,
      };
    }
    console.log(stringify(images));
  });

program
  .command("ctl")
  .description(
    "run talosctl. nodes may be given by name, and `upgrade` and `upgrade-k8s` fill in the image and version",
  )
  .argument("[talosctl-args...]", "passed to talosctl")
  .addOption(dir())
  .helpOption(false)
  .allowUnknownOption()
  .passThroughOptions()
  .action(async (args: string[], o: { dir: string }) => {
    await talosctl(translateArguments(loadTalos(o.dir), args));
  });

if (import.meta.main) {
  await run(program);
}
