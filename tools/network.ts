#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Option } from "commander";
import { parse } from "yaml";
import { align, run } from "./lib/cli.ts";
import {
  applyConfig,
  listOutputs,
  renderNetwork,
} from "./lib/network/config.ts";
import { Client } from "./lib/network/profiles/swos/client.ts";
import { dumpYaml } from "./lib/network/profiles/swos/device.ts";
import { readSecret, secretsFile } from "./lib/secrets/local.ts";

// the network secrets given, else those this machine holds, if it has any
const readSecrets = (given: string | undefined) => {
  const file = secretsFile(given, "network");
  return file ? (parse(readSecret(file)) ?? {}) : undefined;
};

// secrets are only needed by what reaches for them: a switch has none
const withHint = <T>(secrets: unknown, fn: () => T): T => {
  try {
    return fn();
  } catch (e: any) {
    if (secrets === undefined && /is not defined/.test(e.message)) {
      e.message += " (run `just secrets pull`, or give --secrets <file>)";
    }
    throw e;
  }
};

const dir = () =>
  new Option("--dir <dir>", "network configuration").default("network");

const secrets = () =>
  new Option(
    "--secrets <file>",
    "the network secrets, a yaml file (default: ~/.homelab/network.yaml, if there is one)",
  ).env("NETWORK_SECRETS");

const user = () =>
  new Option(
    "--user <name>",
    "the device's user (default: root for openwrt, else admin)",
  );

const password = () =>
  new Option(
    "--password <text>",
    "a swos switch's password (default: none, the factory default)",
  ).env("SWOS_PASSWORD");

const program = new Command()
  .name("network")
  .description(
    "the configuration of the network devices: the router, access points, switches and wireguard clients",
  )
  .showHelpAfterError();

program
  .command("list")
  .description("list the files that can be written, and how each is applied")
  .addOption(dir())
  .action(({ dir }: { dir: string }) => {
    const rows = listOutputs(dir).map((o) => [o.file, o.profile]);
    align([["FILE", "PROFILE"], ...rows]).forEach((line) => console.log(line));
  });

program
  .command("render")
  .description(
    "write the devices' configuration to a directory. it has secrets in it: write it only to out/, which is not committed",
  )
  .argument("[file...]", "only these files")
  .addOption(dir())
  .addOption(secrets())
  .option("--out <dir>", "where to write; replaced on every run", "out/network")
  .action(
    (files: string[], o: { dir: string; secrets?: string; out: string }) => {
      const given = readSecrets(o.secrets);
      const rendered = withHint(given, () =>
        renderNetwork(o.dir, given ?? {}, files),
      );
      rmSync(o.out, { recursive: true, force: true });
      mkdirSync(o.out, { recursive: true });
      for (const [file, content] of Object.entries(rendered)) {
        writeFileSync(join(o.out, file), content, { mode: 0o600 });
      }
      console.log(`wrote ${Object.keys(rendered).length} files to ${o.out}`);
    },
  );

program
  .command("apply")
  .description(
    "send a device its configuration, as rendered here. the device is expected to be factory-reset. wireguard clients are not applied.",
  )
  .argument("<file>", "the device's file (see `list`)")
  .addOption(dir())
  .addOption(secrets())
  .requiredOption(
    "--address <host>",
    "the device; devices are at 192.168.1.1 after a factory reset",
  )
  .addOption(user())
  .addOption(password())
  .option("--dry-run", "say what would happen, and change nothing")
  .option(
    "--reset",
    "routeros: also reset the router to the script (it asks first)",
  )
  .action(
    async (
      file: string,
      o: {
        dir: string;
        secrets?: string;
        address: string;
        user?: string;
        password?: string;
        dryRun?: boolean;
        reset?: boolean;
      },
    ) => {
      const given = readSecrets(o.secrets);
      const output = listOutputs(o.dir, given ?? {}).find(
        (x) => x.file === file,
      );
      if (!output) {
        throw new Error(`no output '${file}' (see 'list')`);
      }
      const content = withHint(given, () => output.render());
      await applyConfig(output.profile, content, {
        address: o.address,
        user: o.user,
        password: o.password,
        dryRun: o.dryRun,
        reset: o.reset,
      });
    },
  );

program
  .command("dump")
  .description("print a SwOS switch's current configuration")
  .argument("<address>", "the switch")
  .addOption(user())
  .addOption(password())
  .action(async (address: string, o: { user?: string; password?: string }) => {
    const client = new Client(
      `http://${address}`,
      o.user ?? "admin",
      o.password ?? "",
    );
    process.stdout.write(await dumpYaml(client));
  });

if (import.meta.main) {
  await run(program);
}
