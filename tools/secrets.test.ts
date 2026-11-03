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

const root = mkdtempSync(join(tmpdir(), "secrets-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));

// a stand-in for bws: it lists what the test gives it, and records how it was called
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "bws"),
  `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.BWS_LOG, JSON.stringify({ args, token: process.env.BWS_ACCESS_TOKEN }) + "\\n");
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(readFileSync(process.env.BWS_FIXTURE, "utf-8"));
}
`,
);
chmodSync(join(bin, "bws"), 0o755);

const home = join(root, "home");
const log = join(root, "bws.log");
const fixture = join(root, "list.json");
const project = "5b43cd1a-4cb5-4ae7-936e-b488012786c2";

const bitwarden = (secrets: Record<string, string>) =>
  writeFileSync(
    fixture,
    JSON.stringify(
      Object.entries(secrets).map(([key, value], i) => ({
        id: `id-${i}`,
        key,
        value,
        projectId: project,
      })),
    ),
  );

const calls = () =>
  existsSync(log)
    ? readFileSync(log, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];

const secrets = (
  args: string[],
  options: { input?: string; env?: Record<string, string> } = {},
) =>
  new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const child = execFile(
      "node",
      [join(import.meta.dirname, "secrets.ts"), ...args],
      {
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          HOMELAB_DIR: home,
          BWS_LOG: log,
          BWS_FIXTURE: fixture,
          BWS_ACCESS_TOKEN: "",
          ...options.env,
        },
      },
      (error, stdout, stderr) =>
        resolve({ stdout, stderr, code: error ? (error.code as number) : 0 }),
    );
    child.stdin!.end(options.input ?? "");
  });

const mode = (file: string) => statSync(file).mode & 0o777;
const signedIn = () => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "bws-token"), "file-token\n", { mode: 0o600 });
};

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(log, { force: true });
  bitwarden({
    talos: "talos: bundle\n",
    network: "wifi: {}\n",
    apps: "secrets: {}\n",
    other: "x",
  });
});

describe("login", () => {
  test("saves a token, for its owner alone", async () => {
    const result = await secrets(["login"], { input: "  my-token\n" });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(join(home, "bws-token"), "utf-8"), "my-token\n");
    assert.equal(mode(join(home, "bws-token")), 0o600);
    assert.equal(mode(home), 0o700);
  });

  test("needs a token", async () => {
    const result = await secrets(["login"], { input: "\n" });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no token given/);
  });
});

describe("pull", () => {
  test("writes the secrets to ~/.homelab, for their owner alone", async () => {
    signedIn();
    const result = await secrets(["pull"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      readFileSync(join(home, "talos.yaml"), "utf-8"),
      "talos: bundle\n",
    );
    assert.equal(
      readFileSync(join(home, "network.yaml"), "utf-8"),
      "wifi: {}\n",
    );
    assert.equal(mode(join(home, "talos.yaml")), 0o600);
    assert.equal(existsSync(join(home, "other.yaml")), false);
    assert.match(
      result.stdout,
      /^talos {2}.*talos\.yaml\nnetwork {2}.*network\.yaml\napps {2}.*apps\.yaml\n$/,
    );
  });

  test("lists the project, with the token that was saved", async () => {
    signedIn();
    await secrets(["pull"]);
    assert.deepEqual(calls(), [
      { args: ["secret", "list", project], token: "file-token" },
    ]);
  });

  test("a token in the environment is used before the saved one", async () => {
    signedIn();
    await secrets(["pull"], { env: { BWS_ACCESS_TOKEN: "env-token" } });
    assert.equal(calls()[0].token, "env-token");
  });

  test("takes the names given, and the project", async () => {
    signedIn();
    await secrets(["pull", "network", "--project", "other-project"]);
    assert.deepEqual(calls()[0].args, ["secret", "list", "other-project"]);
    assert.equal(existsSync(join(home, "network.yaml")), true);
    assert.equal(existsSync(join(home, "talos.yaml")), false);
  });

  test("a secret that isn't in Bitwarden is an error that names it", async () => {
    signedIn();
    bitwarden({ talos: "x" });
    const result = await secrets(["pull"]);
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      new RegExp(`'network' is not in the Bitwarden project ${project}`),
    );
  });

  test("a secret it doesn't handle is an error that lists those it does", async () => {
    signedIn();
    const result = await secrets(["pull", "other"]);
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /no secret 'other' \(have: talos, network, apps\)/,
    );
    assert.deepEqual(calls(), []);
  });

  test("without a token, says how to get one", async () => {
    const result = await secrets(["pull"]);
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /no Bitwarden access token: run `just secrets login`/,
    );
  });

  test("won't use a saved token that others can read", async () => {
    signedIn();
    chmodSync(join(home, "bws-token"), 0o644);
    const result = await secrets(["pull"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be readable by its owner only/);
  });
});

describe("push", () => {
  const write = (name: string, content: string, m = 0o600) => {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(join(home, `${name}.yaml`), content, { mode: m });
  };

  test("updates a secret that is in Bitwarden", async () => {
    signedIn();
    write("talos", "new: bundle\n");
    const result = await secrets(["push", "talos"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /updated talos/);
    assert.deepEqual(calls().at(-1).args, [
      "secret",
      "edit",
      "--output",
      "none",
      "--value",
      "new: bundle\n",
      "id-0",
    ]);
  });

  test("creates one that isn't", async () => {
    signedIn();
    bitwarden({ other: "x" });
    write("network", "wifi: {}\n");
    const result = await secrets(["push", "network"]);
    assert.match(result.stdout, /created network/);
    assert.deepEqual(calls().at(-1).args, [
      "secret",
      "create",
      "--output",
      "none",
      "network",
      "wifi: {}\n",
      project,
    ]);
  });

  test("can take the secret from a file", async () => {
    signedIn();
    const file = join(root, "elsewhere.yaml");
    writeFileSync(file, "from: file\n", { mode: 0o600 });
    await secrets(["push", "talos", file]);
    assert.equal(calls().at(-1).args[5], "from: file\n");
  });

  test("won't send a file that others can read", async () => {
    signedIn();
    write("talos", "x", 0o644);
    const result = await secrets(["push", "talos"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /must be readable by its owner only/);
    assert.deepEqual(calls(), []);
  });

  test("needs a secret there is to send", async () => {
    signedIn();
    const result = await secrets(["push", "talos"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no such secrets file/);
  });
});
