#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { exit, run } from "./lib/cli.ts";
import { writePrivate } from "./lib/secrets/local.ts";
import { loadTalos } from "./lib/talos/config.ts";

// readies this machine to work on the cluster: the secrets, then the clients that use them

const tool = (name: string) => join(import.meta.dirname, `${name}.ts`);

interface Options {
  dir: string;
  timeout: string;
}

const program = new Command()
  .name("init")
  .description(
    "pulls the secrets, then writes ~/.talos/config and (if the cluster is reachable) ~/.kube/config",
  )
  .option("--dir <dir>", "talos configuration", "talos")
  .option(
    "--timeout <seconds>",
    "how long to wait for the cluster to give its kubeconfig",
    "30",
  )
  .showHelpAfterError()
  .action((o: Options) => {
    // a failure here (e.g. not signed in) says what to do about it
    const pull = spawnSync("node", [tool("secrets"), "pull"], {
      stdio: "inherit",
    });
    if (pull.status !== 0) {
      return exit(1);
    }

    const talos = loadTalos(o.dir);
    const clientConfig = spawnSync(
      "node",
      [tool("talos"), "client-config", "--dir", o.dir],
      { stdio: ["inherit", "pipe", "inherit"], encoding: "utf-8" },
    );
    if (clientConfig.status !== 0) {
      return exit(1);
    }
    writePrivate(join(homedir(), ".talos", "config"), clientConfig.stdout);
    console.log("wrote ~/.talos/config");

    // the cluster is only reachable from some networks (the VPN), and talosctl waits indefinitely
    const node = talos.nodes.find(
      (n) => n.enabled && n.role === "controlplane",
    );
    if (!node) {
      throw new Error(`no enabled control plane node in ${o.dir}`);
    }
    mkdirSync(join(homedir(), ".kube"), { recursive: true });
    const kubeconfig = spawnSync(
      "timeout",
      [
        "--kill-after=5",
        o.timeout,
        "node",
        tool("talos"),
        "ctl",
        "--dir",
        o.dir,
        "-n",
        node.name,
        "kubeconfig",
      ],
      { stdio: "inherit" },
    );
    if (kubeconfig.status === 0) {
      console.log("wrote ~/.kube/config");
    } else {
      console.log(
        "no kubeconfig: the cluster is not reachable (is the VPN up?). run `just init` again when it is",
      );
    }
  });

if (import.meta.main) {
  await run(program);
}
