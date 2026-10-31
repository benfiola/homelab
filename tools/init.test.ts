import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "init-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));

const stub = (name: string, source: string) => {
  writeFileSync(join(bin, name), `#!/usr/bin/env node\n${source}`);
  chmodSync(join(bin, name), 0o755);
};

// stand-ins for bws, which lists three secrets, and for talosctl, which generates a client
// configuration and records the kubeconfig it is asked for (or never answers, if told to hang)
const bin = join(root, "bin");
mkdirSync(bin);
stub(
  "bws",
  `process.stdout.write(JSON.stringify(["talos", "network", "flux", "apps"].map((key, i) => ({ id: "" + i, key, value: key + ": x\\n", projectId: "p" }))));`,
);
stub(
  "talosctl",
  `const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.TALOSCTL_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "gen") {
  process.stdout.write("context: homelab\\ncontexts:\\n  homelab: {}\\n");
} else if (process.env.TALOSCTL_HANG) {
  setTimeout(() => {}, 60000);
}`,
);

const home = join(root, "home");
const log = join(root, "talosctl.log");

const init = (env: Record<string, string> = {}, ...args: string[]) =>
  new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    execFile(
      "node",
      [join(import.meta.dirname, "init.ts"), ...args],
      {
        cwd: join(import.meta.dirname, ".."),
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          HOME: home,
          HOMELAB_DIR: join(home, ".homelab"),
          TALOSCTL_LOG: log,
          BWS_ACCESS_TOKEN: "",
          ...env,
        },
      },
      (error, stdout, stderr) =>
        resolve({ stdout, stderr, code: error ? (error.code as number) : 0 }),
    );
  });

const signedIn = () => {
  mkdirSync(join(home, ".homelab"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, ".homelab", "bws-token"), "t\n", { mode: 0o600 });
};

const calls = (): string[][] =>
  existsSync(log)
    ? readFileSync(log, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(log, { force: true });
});

describe("init", () => {
  test("pulls the secrets, and writes the talos and kube configuration", async () => {
    signedIn();
    const result = await init();
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      readFileSync(join(home, ".homelab", "flux.yaml"), "utf-8"),
      "flux: x\n",
    );
    const talosconfig = join(home, ".talos", "config");
    assert.match(readFileSync(talosconfig, "utf-8"), /^context: homelab$/m);
    assert.equal(statSync(talosconfig).mode & 0o777, 0o600);
    const kubeconfig = calls().find((c) => c.includes("kubeconfig"))!;
    assert.match(kubeconfig.join(" "), /--nodes=samoyed\.cluster\.fiola\.dev/);
    assert.match(result.stdout, /wrote ~\/\.kube\/config/);
  });

  test("not signed in: says how to sign in, and does no more", async () => {
    const result = await init();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /run `just secrets login`/);
    assert.deepEqual(calls(), []);
    assert.equal(existsSync(join(home, ".talos", "config")), false);
  });

  test("gives up on an unreachable cluster, but still succeeds", async () => {
    signedIn();
    const started = Date.now();
    const result = await init({ TALOSCTL_HANG: "1" }, "--timeout", "1");
    assert.equal(result.code, 0, result.stderr);
    assert.ok(Date.now() - started < 20000, "waited for the timeout only");
    assert.match(result.stdout, /no kubeconfig: the cluster is not reachable/);
    assert.equal(existsSync(join(home, ".talos", "config")), true);
  });
});
