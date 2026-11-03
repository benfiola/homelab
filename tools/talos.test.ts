import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, describe, test } from "node:test";
import { loadTalos } from "./lib/talos/config.ts";
import { render } from "./talos.ts";
import { hasCommand } from "./lib/testing.ts";

const hasTalosctl = hasCommand("talosctl");

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// the real configuration of this repository, rendered with a throwaway secrets bundle
describe(
  "talos config",
  { skip: !hasTalosctl && "talosctl is not installed" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "talos-secrets-"));
    dirs.push(dir);
    const secrets = join(dir, "secrets.yaml");
    execFileSync("talosctl", ["gen", "secrets", "-o", secrets], {
      stdio: "ignore",
    });
    const talos = loadTalos(join(import.meta.dirname, "../talos"));

    test("every node's configuration names the node and its disks", async () => {
      const configs = await render(talos, talos.nodes, secrets);
      for (const node of talos.nodes) {
        const docs = configs[node.name];
        assert.equal(
          docs.find((d) => d.kind === "HostnameConfig")?.hostname,
          node.hostname,
        );
        assert.equal(
          docs.find((d) => d.kind === "DHCPv4Config")?.name,
          node.interface,
        );
        assert.ok(
          docs.some(
            (d) => d.kind === "RawVolumeConfig" && d.name === "linstor",
          ),
          node.name,
        );
      }
    });

    test("every node gets the shared configuration, and its profile's", async () => {
      const configs = await render(talos, talos.nodes, secrets);
      for (const node of talos.nodes) {
        const [machine] = configs[node.name];
        const modules = machine.machine.kernel.modules.map((m: any) => m.name);
        assert.ok(modules.includes("drbd"), `${node.name}: shared drbd module`);
        assert.equal(
          modules.includes("nvidia"),
          node.profile === "axp",
          `${node.name}: profile's nvidia modules`,
        );
        const install = configs[node.name].find(
          (d) => d.kind === "UnattendedInstallConfig",
        );
        assert.equal(
          install?.installer.image,
          talos.profiles[node.profile].image,
        );
        assert.ok(
          configs[node.name].some(
            (d) => d.kind === "BridgeConfig" && d.name === "mdns0",
          ),
        );
      }
    });

    test("the control plane is generated for the control plane, and the workers' are not", async () => {
      const configs = await render(talos, talos.nodes, secrets);
      for (const node of talos.nodes) {
        assert.equal(configs[node.name][0].machine.type, node.role);
        assert.equal(
          configs[node.name].some((d) => d.kind === "KubeAPIServerConfig"),
          node.role === "controlplane",
        );
      }
    });
  },
);

// talosctl is given the arguments it was run with, nodes by name made into hostnames
describe("talos ctl", () => {
  const bin = mkdtempSync(join(tmpdir(), "talos-bin-"));
  dirs.push(bin);
  writeFileSync(join(bin, "talosctl"), '#!/bin/sh\necho "$@"\n');
  chmodSync(join(bin, "talosctl"), 0o755);

  const ctl = (...args: string[]) =>
    execFileSync(
      "node",
      [join(import.meta.dirname, "talos.ts"), "ctl", ...args],
      {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
        encoding: "utf-8",
      },
    ).trim();

  test("passes arguments and options through", () => {
    assert.equal(ctl("get", "members"), "get members");
    assert.equal(ctl("get", "-h"), "get -h");
    assert.equal(ctl("--help"), "--help");
    assert.equal(ctl("-h"), "-h");
    assert.equal(
      ctl("logs", "-f", "--tail", "5", "kubelet"),
      "logs -f --tail 5 kubelet",
    );
  });

  test("makes a node's name its hostname, wherever the option is", () => {
    const host = (name: string) => `${name}.cluster.fiola.dev`;
    assert.equal(
      ctl("-n", "samoyed", "version"),
      `--nodes=${host("samoyed")} version`,
    );
    assert.equal(
      ctl("version", "--nodes=samoyed,husky"),
      `version --nodes=${host("samoyed")},${host("husky")}`,
    );
  });

  test("fills in the image of an upgrade, and the version of a kubernetes upgrade", () => {
    assert.match(
      ctl("upgrade", "--nodes", "samoyed"),
      /^upgrade --nodes=\S+ --image=factory\.talos\.dev\/\S+:v\d/,
    );
    assert.match(ctl("upgrade-k8s"), /^upgrade-k8s --to=\d+\.\d+\.\d+$/);
  });
});

describe("talos secrets", () => {
  const home = mkdtempSync(join(tmpdir(), "talos-home-"));
  dirs.push(home);

  const talos = (...args: string[]) => {
    try {
      execFileSync("node", [join(import.meta.dirname, "talos.ts"), ...args], {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, HOMELAB_DIR: home, TALOS_SECRETS: "" },
        encoding: "utf-8",
        stdio: "pipe",
      });
      return "";
    } catch (e: any) {
      return String(e.stderr);
    }
  };

  test("without a secrets bundle, says how to get one", () => {
    for (const command of ["config", "apply", "client-config"]) {
      assert.match(
        talos(command),
        /no secrets bundle: run `just secrets pull`, or give --secrets <file>/,
      );
    }
  });

  test("a bundle that others can read is refused", () => {
    const file = join(home, "loose.yaml");
    writeFileSync(file, "x", { mode: 0o644 });
    assert.match(
      talos("client-config", "--secrets", file),
      /has mode 644: it must be readable by its owner only/,
    );
  });
});
