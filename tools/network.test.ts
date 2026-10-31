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
import { after, describe, test } from "node:test";
import { promisify } from "node:util";
import { stringify } from "yaml";
import {
  files,
  secrets as fixtureSecrets,
  workspace,
} from "./lib/network/fixture.ts";
import {
  startSwitch,
  type FakeSwitch,
} from "./lib/network/profiles/swos/fake.ts";
import { hexDecode } from "./lib/network/profiles/swos/protocol.ts";

const root = mkdtempSync(join(tmpdir(), "network-cli-"));
const switches: FakeSwitch[] = [];
after(async () => {
  rmSync(root, { recursive: true, force: true });
  await Promise.all(switches.map((s) => s.close()));
});

// stand-ins for ssh and scp that record how they were called, and what they were sent
const bin = join(root, "bin");
const log = join(root, "calls.log");
mkdirSync(bin);
for (const name of ["ssh", "scp"]) {
  const script = join(bin, name);
  writeFileSync(
    script,
    `#!/bin/sh
echo "${name} $*" >> ${log}
case "${name} $*" in
  scp*) cp "$1" ${log}.scp ;;
  *"cat >"*) cat >> ${log}.stdin ;;
esac
`,
  );
  chmodSync(script, 0o755);
}

const dir = workspace(files, [root]);
const secrets = join(root, "secrets.yaml");
writeFileSync(secrets, stringify(fixtureSecrets), { mode: 0o600 });

// the commands that read the network configuration
const commandsWithDir = ["list", "render", "apply"];

const network = (args: string[], env: Record<string, string> = {}) =>
  promisify(execFile)(
    "node",
    [
      join(import.meta.dirname, "network.ts"),
      ...args,
      ...(commandsWithDir.includes(args[0]) ? ["--dir", dir] : []),
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        // not this machine's own secrets
        HOMELAB_DIR: join(root, "no-secrets"),
        NETWORK_SECRETS: "",
        ...env,
      },
    },
  ).catch((e) => ({
    stdout: e.stdout as string,
    stderr: e.stderr as string,
    code: e.code as number,
  }));

type Result = { stdout: string; stderr: string; code?: number };
const run = async (args: string[], env?: Record<string, string>) =>
  (await network(args, env)) as Result;

describe("list", () => {
  test("says how each file is applied, in aligned columns", async () => {
    const { stdout } = await run(["list"]);
    assert.equal(
      stdout,
      [
        "FILE                           PROFILE",
        "router.rsc                     routeros",
        "ap.one.sh                      openwrt",
        "core.switch.yaml               swos",
        "wireguard.laptop-home.conf     wireguard",
        "wireguard.laptop-servers.conf  wireguard",
        "wireguard.phone.conf           wireguard",
        "",
      ].join("\n"),
    );
  });
});

describe("render", () => {
  test("writes the files to a replaced directory, for their owner only", async () => {
    const out = join(root, "out");
    mkdirSync(out);
    writeFileSync(join(out, "stale"), "");
    await run(["render", "--secrets", secrets, "--out", out]);
    assert.equal(existsSync(join(out, "stale")), false);
    assert.match(
      readFileSync(join(out, "ap.one.sh"), "utf-8"),
      /hostname=ap\.one/,
    );
    assert.match(
      readFileSync(join(out, "wireguard.phone.conf"), "utf-8"),
      /PrivateKey = PH/,
    );
    assert.equal(statSync(join(out, "ap.one.sh")).mode & 0o777, 0o600);
  });

  test("a secret that is needed and not given is an error that says where to give it", async () => {
    const result = await run(["render", "ap.one.sh"]);
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /secrets\.wifi\.home' is not defined \(run `just secrets pull`, or give --secrets <file>\)/,
    );
  });

  test("takes the secrets this machine holds, when none are given", async () => {
    const home = join(root, "home");
    mkdirSync(home, { mode: 0o700 });
    writeFileSync(join(home, "network.yaml"), stringify(fixtureSecrets), {
      mode: 0o600,
    });
    const out = join(root, "out-home");
    const result = await run(["render", "ap.one.sh", "--out", out], {
      HOMELAB_DIR: home,
    });
    assert.equal(result.code, undefined, result.stderr);
    assert.match(readFileSync(join(out, "ap.one.sh"), "utf-8"), /key='HOME'/);
  });

  test("refuses secrets that others can read", async () => {
    const loose = join(root, "loose.yaml");
    writeFileSync(loose, stringify(fixtureSecrets), { mode: 0o644 });
    const result = await run(["render", "--secrets", loose]);
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /has mode 644: it must be readable by its owner only/,
    );
  });

  test("the secrets may be in the environment", async () => {
    const out = join(root, "out-env");
    await run(["render", "ap.one.sh", "--out", out], {
      NETWORK_SECRETS: secrets,
    });
    assert.match(readFileSync(join(out, "ap.one.sh"), "utf-8"), /key='HOME'/);
  });
});

describe("apply", () => {
  test("an output it doesn't know is an error", async () => {
    assert.match(
      (await run(["apply", "nope", "--address", "a"])).stderr,
      /no output 'nope'/,
    );
  });

  test("a switch gets its configuration, without secrets", async () => {
    const fake = await startSwitch({ password: "pw" });
    switches.push(fake);
    const env = { SWOS_PASSWORD: "pw" };
    const first = await run(
      ["apply", "core.switch.yaml", "--address", fake.address],
      env,
    );
    assert.match(
      first.stdout,
      /system\.identity: "MikroTik" -> "core\.switch"/,
    );
    assert.match(first.stdout, /^applied$/m);
    assert.equal(hexDecode(fake.state.sys.id), "core.switch");
    const second = await run(
      ["apply", "core.switch.yaml", "--address", fake.address],
      env,
    );
    assert.match(second.stdout, /nothing to change/);
  });

  test("a wrong switch password fails", async () => {
    const fake = await startSwitch({ password: "pw" });
    switches.push(fake);
    const result = await run([
      "apply",
      "core.switch.yaml",
      "--address",
      fake.address,
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /HTTP 401/);
  });

  test("an access point gets its script over ssh", async () => {
    rmSync(log, { force: true });
    rmSync(`${log}.stdin`, { force: true });
    const result = await run([
      "apply",
      "ap.one.sh",
      "--address",
      "ap.test",
      "--secrets",
      secrets,
    ]);
    assert.equal(result.code, undefined, result.stderr);
    const calls = readFileSync(log, "utf-8");
    assert.match(
      calls,
      /ssh root@ap\.test umask 077 && cat > \/tmp\/homelab\.sh/,
    );
    assert.match(calls, /ssh root@ap\.test sh \/tmp\/homelab\.sh/);
    const sent = readFileSync(`${log}.stdin`, "utf-8");
    assert.match(sent, /hostname=ap\.one/);
    assert.match(sent, /set wireless\.home2g\.key='HOME'/);
  });

  test("a router gets its script copied, and is reset only when asked", async () => {
    rmSync(log, { force: true });
    await run([
      "apply",
      "router.rsc",
      "--address",
      "r.test",
      "--secrets",
      secrets,
    ]);
    assert.match(readFileSync(log, "utf-8"), /r\.test:script\.rsc\n$/);
    assert.match(readFileSync(`${log}.scp`, "utf-8"), /password=ROUTER/);
    assert.doesNotMatch(readFileSync(log, "utf-8"), /reset-configuration/);

    rmSync(log, { force: true });
    await run([
      "apply",
      "router.rsc",
      "--address",
      "r.test",
      "--secrets",
      secrets,
      "--reset",
    ]);
    assert.match(
      readFileSync(log, "utf-8"),
      /ssh -t admin@r\.test \/system\/reset-configuration no-defaults=yes run-after-reset=script\.rsc/,
    );
  });

  test("a dry run touches no device", async () => {
    rmSync(log, { force: true });
    const result = await run([
      "apply",
      "ap.one.sh",
      "--address",
      "a",
      "--secrets",
      secrets,
      "--dry-run",
    ]);
    assert.match(result.stdout, /would run: ssh root@a/);
    assert.equal(existsSync(log), false);
  });

  test("a wireguard client is not applied", async () => {
    const result = await run([
      "apply",
      "wireguard.phone.conf",
      "--address",
      "a",
      "--secrets",
      secrets,
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /imported on the device/);
  });
});

describe("dump", () => {
  test("prints a switch's configuration as yaml", async () => {
    const fake = await startSwitch();
    switches.push(fake);
    const { stdout } = await run(["dump", fake.address]);
    assert.match(stdout, /^system:\n {2}identity: MikroTik\n/);
    assert.match(stdout, /name: Port18/);
  });
});
