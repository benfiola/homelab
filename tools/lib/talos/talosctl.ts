import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseAllDocuments, stringify } from "yaml";
import type { Profile, Node, Talos } from "./config.ts";

const run = promisify(execFile);

type Obj = Record<string, any>;

const documents = (text: string): Obj[] =>
  parseAllDocuments(text)
    .map((doc) => doc.toJSON())
    .filter(Boolean);

// `talosctl gen config`, from the cluster's secrets bundle so that every run (and every node) agrees
const generate = async (
  talos: Talos,
  secrets: string,
  args: string[],
): Promise<Obj[]> => {
  const { cluster } = talos;
  const { stdout } = await run(
    "talosctl",
    [
      "gen",
      "config",
      cluster.name,
      `https://${cluster.endpoint}:6443`,
      "--output=-",
      `--with-secrets=${secrets}`,
      ...args,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  ).catch((e) => {
    throw new Error(
      `talosctl gen config: ${String(e.stderr || e.message).trim()}`,
    );
  });
  return documents(stdout);
};

// what talos generates for a node's role, before any of our configuration is merged over it
export const generateNodeConfig = (
  talos: Talos,
  node: Node,
  profile: Profile,
  secrets: string,
) =>
  generate(talos, secrets, [
    `--additional-sans=${talos.cluster.endpoint}`,
    `--install-disk=${profile.disks.SYSTEM.device}`,
    `--install-image=${profile.image}`,
    `--kubernetes-version=${talos.cluster.kubernetes}`,
    `--output-types=${node.role}`,
    "--with-cluster-discovery=false",
    "--with-docs=false",
    "--with-examples=false",
    "--with-kubespan=false",
  ]);

// the client configuration (talosconfig), pointing at the cluster's endpoint and its enabled nodes
export const generateClientConfig = async (
  talos: Talos,
  secrets: string,
): Promise<Obj> => {
  const [config] = await generate(talos, secrets, [
    "--output-types=talosconfig",
  ]);
  const context = config.contexts[talos.cluster.name];
  context.endpoints = [talos.cluster.endpoint];
  context.nodes = talos.nodes.filter((n) => n.enabled).map((n) => n.hostname);
  return config;
};

export const toYaml = (docs: Obj[]) =>
  docs
    .map((doc) =>
      stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false }),
    )
    .join("---\n");

const inherit = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("talosctl", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`talosctl ${args[0]} exited with ${code}`)),
    );
  });

export const applyConfig = async (
  node: Node,
  docs: Obj[],
  opts: { insecure?: boolean } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "talos-"));
  try {
    const file = join(dir, "config.yaml");
    writeFileSync(file, toYaml(docs), { mode: 0o600 });
    await inherit([
      "apply-config",
      `--file=${file}`,
      ...(opts.insecure === undefined ? [] : [`--insecure=${opts.insecure}`]),
      `--nodes=${node.hostname}`,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const talosctl = (args: string[]) => inherit(args);

// registers an image's schematic with the image factory, which returns the id the image is named by
export const createSchematic = async (schematic: Obj): Promise<string> => {
  const response = await fetch("https://factory.talos.dev/schematics", {
    method: "POST",
    body: JSON.stringify(schematic),
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.url} (${response.status})`);
  }
  const { id } = (await response.json()) as { id?: unknown };
  if (typeof id !== "string" || !id) {
    throw new Error("unexpected image factory response");
  }
  return id;
};
