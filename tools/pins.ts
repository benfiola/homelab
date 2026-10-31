import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { Command } from "commander";
import { exit, run } from "./lib/cli.ts";
import { align } from "./lib/table.ts";
import { parseWith, z } from "./lib/schema.ts";

// pins.json is read by lib.nix (to build the pinned tool derivations) and by this
// script (to refresh their hashes from the checksums upstream publishes).

const pin = z.strictObject({
  version: z.string(),
  url: z.string(),
  checksum: z.string(),
  unpack: z.enum(["none", "tar", "zip"]),
  bin: z.string().optional(),
  // how the upstream names an arch, where it isn't amd64/arm64 (hashes stay keyed by amd64/arm64)
  arches: z.record(z.string(), z.string()).optional(),
  hashes: z.record(z.string(), z.string()),
});

export type Pin = z.output<typeof pin>;

const arches = ["amd64", "arm64"];
const pinsPath = new URL("../pins.json", import.meta.url);

export const substitute = (template: string, vars: Record<string, string>) =>
  template.replace(/\$\{(\w+)\}/g, (_, name) => {
    if (!(name in vars)) {
      throw new Error(`unknown variable '${name}' in '${template}'`);
    }
    return vars[name];
  });

export const toSri = (hex: string) =>
  `sha256-${Buffer.from(hex, "hex").toString("base64")}`;

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed (${response.status}): ${url}`);
  }
  return await response.text();
};

// accepts either a bare hash, or `<hash>  <filename>` lines (picking `asset`)
export const findHash = (text: string, asset: string) => {
  const bare = text.trim().match(/^[0-9a-f]{64}$/i);
  if (bare) {
    return bare[0].toLowerCase();
  }
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/i);
    if (match && basename(match[2]) === asset) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`no checksum for '${asset}'`);
};

const load = () =>
  parseWith(
    z.record(z.string(), pin),
    JSON.parse(readFileSync(pinsPath, "utf-8")),
    "pins.json",
  );

// brings every hash in line with the checksums upstream publishes, and lists those that changed
export const refresh = async (
  pins: Record<string, Pin>,
  get: (url: string) => Promise<string> = fetchText,
): Promise<number> => {
  const changed: string[][] = [];
  for (const [tool, pin] of Object.entries(pins)) {
    for (const arch of arches) {
      const vars = { version: pin.version, arch: pin.arches?.[arch] ?? arch };
      const url = substitute(pin.url, vars);
      const checksumUrl = substitute(pin.checksum, { ...vars, url });
      const hash = toSri(findHash(await get(checksumUrl), basename(url)));
      if (pin.hashes[arch] !== hash) {
        changed.push([tool, pin.version, arch, hash]);
        pin.hashes[arch] = hash;
      }
    }
  }
  align(changed).forEach((line) => console.log(line));
  return changed.length;
};

const save = (pins: Record<string, Pin>) =>
  writeFileSync(pinsPath, `${JSON.stringify(pins, null, 2)}\n`);

const program = new Command()
  .name("pins")
  .description(
    "the tools pinned in pins.json: their versions, and the download hashes taken from upstream's checksum files",
  );

program
  .command("set")
  .description("set a tool's version, and refresh the hashes")
  .argument("<tool>", "a tool in pins.json (e.g. kubectl)")
  .argument("<version>", "the version (e.g. 1.36.6)")
  .action(async (tool: string, version: string) => {
    const pins = load();
    if (!pins[tool]) {
      throw new Error(
        `no tool '${tool}' (have: ${Object.keys(pins).join(", ")})`,
      );
    }
    pins[tool].version = version;
    await refresh(pins);
    save(pins);
  });

program
  .command("refresh")
  .description("refresh every hash, after a version changes")
  .action(async () => {
    const pins = load();
    await refresh(pins);
    save(pins);
  });

program
  .command("check")
  .description("change nothing; exit 1 if any hash is out of date")
  .action(async () => {
    const outdated = await refresh(load());
    console.log(
      outdated === 0 ? "pins are up to date" : `${outdated} hashes out of date`,
    );
    exit(outdated === 0 ? 0 : 1);
  });

if (import.meta.main) {
  await run(program);
}
