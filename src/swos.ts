import { isDeepStrictEqual } from "node:util";
import { DigestClient } from "digest-fetch";
import { readFile } from "fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import * as zod from "zod";
import { logger } from "./logger";

// ── SwOS Wire Protocol ────────────────────────────────────────────────────────

/**
 * Parse SwOS JS object notation to a JS value.
 *
 * SwOS returns non-standard JSON: bare hex literals (0x3ff), unquoted keys,
 * and single-quoted hex strings ('506f727431'). This converts it to valid JSON
 * then parses it. The same logic as python-mikrotik-swos's parse_js_object().
 */
function parseSwos(text: string): unknown {
  let s = text.trim();
  // Convert bare 0x hex literals to decimal (must happen before quote replacement)
  s = s.replace(/0x([0-9a-fA-F]+)/g, (_, h) => parseInt(h, 16).toString());
  // Quote unquoted object keys
  s = s.replace(/([{,\[]\s*)([a-zA-Z_!][a-zA-Z0-9_!]*)(\s*:)/g, '$1"$2"$3');
  // Single-quoted strings → double-quoted
  s = s.replace(/'([^']*)'/g, '"$1"');
  return JSON.parse(s);
}

/** Hex-encode a UTF-8 string to the SwOS wire representation (no quotes). */
function hexEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("hex");
}

/** Decode a SwOS hex-encoded string back to UTF-8. */
function hexDecode(s: string): string {
  return Buffer.from(s, "hex").toString("utf8");
}

/** Format a number as even-length hex with 0x prefix (e.g. 511 → "0x01ff"). */
function evenHex(n: number): string {
  const h = n.toString(16);
  return "0x" + (h.length % 2 ? "0" + h : h);
}

/** Convert a 1-based port list to a bitmask (port 1 = bit 0). */
function toMask(ports: number[]): number {
  return ports.reduce((m, p) => m | (1 << (p - 1)), 0);
}

/** Convert a bitmask back to a 1-based port list. */
function fromMask(mask: number, totalPorts: number): number[] {
  return Array.from({ length: totalPorts }, (_, i) => i + 1).filter(
    (p) => mask & (1 << (p - 1)),
  );
}

/**
 * Format a value for the SwOS POST body.
 * - number  → even-length hex: 0x01ff
 * - string  → hex-encoded, single-quoted: '506f727431'
 * - array   → [elements...]  with same rules per element
 */
function wireVal(v: unknown): string {
  if (Array.isArray(v)) {
    return (
      "[" +
      v
        .map((e) =>
          typeof e === "string" ? `'${hexEncode(e)}'` : evenHex(e as number),
        )
        .join(",") +
      "]"
    );
  }
  if (typeof v === "number") return evenHex(v);
  if (typeof v === "string") return `'${hexEncode(v)}'`;
  throw new Error(`Unsupported wire value type: ${typeof v}`);
}

function wireObj(obj: Record<string, unknown>): string {
  return (
    "{" +
    Object.entries(obj)
      .map(([k, v]) => `${k}:${wireVal(v)}`)
      .join(",") +
    "}"
  );
}

function wireArr(items: Record<string, unknown>[]): string {
  return "[" + items.map(wireObj).join(",") + "]";
}

// ── SwOS HTTP Client ──────────────────────────────────────────────────────────

class SwosClient {
  private digest: DigestClient;

  constructor(private url: string, username: string, password: string) {
    this.digest = new DigestClient(username, password);
  }

  async get(endpoint: string): Promise<unknown> {
    const res = await this.digest.fetch(`${this.url}/${endpoint}.b`);
    if (!res.ok) throw new Error(`GET /${endpoint}.b: HTTP ${res.status}`);
    return parseSwos(await res.text());
  }

  async post(
    endpoint: string,
    data: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<void> {
    const body = Array.isArray(data) ? wireArr(data) : wireObj(data);
    const res = await this.digest.fetch(`${this.url}/${endpoint}.b`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });
    if (!res.ok) throw new Error(`POST /${endpoint}.b: HTTP ${res.status}`);
  }
}

// ── Config Schema ─────────────────────────────────────────────────────────────

const portConfigSchema = zod.object({
  /** 1-based port index */
  index: zod.number().int().min(1),
  name: zod.string().optional(),
  enabled: zod.boolean().optional(),
  vlan: zod
    .object({
      /**
       * disabled: ignore all VLAN tags
       * optional: use VLAN if tag present, else default
       * enabled:  require a VLAN match
       * strict:   drop frames not matching any VLAN
       */
      mode: zod
        .enum(["disabled", "optional", "enabled", "strict"])
        .optional(),
      /**
       * 802.1Q acceptable frame types for this port's ingress filter:
       * any: accept tagged and untagged frames
       * tagged: accept only VLAN-tagged frames (trunk ports)
       * untagged: accept only untagged frames (access ports)
       */
      receive: zod.enum(["any", "tagged", "untagged"]).optional(),
      /** VLAN ID assigned to untagged ingress frames */
      defaultVlanId: zod.number().int().min(1).max(4094).optional(),
      /**
       * Force all traffic on this port onto defaultVlanId, bypassing VLAN
       * table matching entirely (e.g. useful for a rescue/recovery port).
       */
      forceVlanId: zod.boolean().optional(),
    })
    .optional(),
});

const vlanConfigSchema = zod.object({
  id: zod.number().int().min(1).max(4094),
  name: zod.string().default(""),
  /** 1-based port indices that are members of this VLAN */
  members: zod.array(zod.number().int().min(1)),
});

const configSchema = zod.object({
  system: zod
    .object({
      identity: zod.string().optional(),
    })
    .optional(),
  ports: zod.array(portConfigSchema).optional(),
  vlans: zod.array(vlanConfigSchema).optional(),
});

type Config = zod.infer<typeof configSchema>;

// ── VLAN mode index mapping ───────────────────────────────────────────────────

const VLAN_MODES = ["disabled", "optional", "enabled", "strict"] as const;
type VlanMode = (typeof VLAN_MODES)[number];

// 802.1Q acceptable frame types, indexed by raw vlni value.
const RECEIVE_MODES = ["any", "tagged", "untagged"] as const;
type ReceiveMode = (typeof RECEIVE_MODES)[number];

// ── Apply ─────────────────────────────────────────────────────────────────────

type LinkData = {
  nm: string[];
  en: number;
  an: number;
};

type FwdData = {
  vlan: number[];
  vlni: number[];
  dvid: number[];
  /** Per-port bitmask (bit i = port i+1): "Force VLAN ID" enabled. */
  fvid: number;
};

type VlanEntry = {
  vid: number;
  mbr: number;
  nm: string;
  igmp: number;
};

type SysData = {
  id: string;
  [key: string]: unknown;
};

export async function applyConfig(
  configPath: string,
  address: string,
  username: string,
  password: string,
  dryRun: boolean,
) {
  const raw = await readFile(configPath, "utf8");
  const config: Config = configSchema.parse(parseYaml(raw));

  const client = new SwosClient(`http://${address}`, username, password);

  const linkData = (await client.get("link")) as LinkData;
  const fwdData = (await client.get("fwd")) as FwdData;
  const vlanData = (await client.get("vlan")) as VlanEntry[];
  const sysData = (await client.get("sys")) as SysData;

  const numPorts = linkData.nm.length;
  logger().info(`Connected: ${address} (${numPorts} ports detected)`);

  // ── System identity ─────────────────────────────────────────────────────────
  if (config.system?.identity !== undefined) {
    const current = hexDecode(sysData.id);
    const desired = config.system.identity;
    if (current !== desired) {
      logger().info(`  sys.identity: "${current}" → "${desired}"`);
      if (!dryRun) {
        // Only send id; SwOS applies partial updates for sys.b
        await client.post("sys", { id: desired });
      }
    }
  }

  // ── Port names + enabled ────────────────────────────────────────────────────
  if (config.ports) {
    const names = linkData.nm.map(hexDecode);
    let newNames = [...names];
    let newEnabled = linkData.en;
    let linkChanged = false;

    for (const p of config.ports) {
      const i = p.index - 1;
      if (i >= numPorts)
        throw new Error(`Port index ${p.index} exceeds switch port count ${numPorts}`);

      if (p.name !== undefined && newNames[i] !== p.name) {
        logger().info(`  port[${p.index}].name: "${newNames[i]}" → "${p.name}"`);
        newNames[i] = p.name;
        linkChanged = true;
      }

      if (p.enabled !== undefined) {
        const cur = !!(linkData.en & (1 << i));
        if (cur !== p.enabled) {
          logger().info(`  port[${p.index}].enabled: ${cur} → ${p.enabled}`);
          newEnabled = p.enabled
            ? newEnabled | (1 << i)
            : newEnabled & ~(1 << i);
          linkChanged = true;
        }
      }
    }

    if (linkChanged && !dryRun) {
      await client.post("link", {
        en: newEnabled,
        an: linkData.an,
        nm: newNames,
      });
    }
  }

  // ── Per-port VLAN settings ──────────────────────────────────────────────────
  if (config.ports?.some((p) => p.vlan)) {
    const modes = [...fwdData.vlan];
    const receives = [...fwdData.vlni];
    const dvids = [...fwdData.dvid];
    let fvid = fwdData.fvid;
    let fwdChanged = false;

    for (const p of config.ports ?? []) {
      if (!p.vlan) continue;
      const i = p.index - 1;

      if (p.vlan.mode !== undefined) {
        const want = VLAN_MODES.indexOf(p.vlan.mode as VlanMode);
        if (modes[i] !== want) {
          logger().info(
            `  port[${p.index}].vlan.mode: ${VLAN_MODES[modes[i]]} → ${p.vlan.mode}`,
          );
          modes[i] = want;
          fwdChanged = true;
        }
      }

      if (p.vlan.receive !== undefined) {
        const want = RECEIVE_MODES.indexOf(p.vlan.receive as ReceiveMode);
        if (receives[i] !== want) {
          logger().info(
            `  port[${p.index}].vlan.receive: ${RECEIVE_MODES[receives[i]]} → ${p.vlan.receive}`,
          );
          receives[i] = want;
          fwdChanged = true;
        }
      }

      if (
        p.vlan.defaultVlanId !== undefined &&
        dvids[i] !== p.vlan.defaultVlanId
      ) {
        logger().info(
          `  port[${p.index}].vlan.defaultVlanId: ${dvids[i]} → ${p.vlan.defaultVlanId}`,
        );
        dvids[i] = p.vlan.defaultVlanId;
        fwdChanged = true;
      }

      if (p.vlan.forceVlanId !== undefined) {
        const cur = !!(fvid & (1 << i));
        if (cur !== p.vlan.forceVlanId) {
          logger().info(
            `  port[${p.index}].vlan.forceVlanId: ${cur} → ${p.vlan.forceVlanId}`,
          );
          fvid = p.vlan.forceVlanId ? fvid | (1 << i) : fvid & ~(1 << i);
          fwdChanged = true;
        }
      }
    }

    if (fwdChanged && !dryRun) {
      await client.post("fwd", {
        vlan: modes,
        vlni: receives,
        dvid: dvids,
        fvid,
      });
    }
  }

  // ── VLAN table ──────────────────────────────────────────────────────────────
  if (config.vlans) {
    const desiredVlans = config.vlans.map((v) => ({
      vid: v.id,
      mbr: toMask(v.members),
      nm: v.name,
      igmp: 0,
    }));

    // Normalize both sides for comparison
    const normalize = (vs: typeof desiredVlans) =>
      [...vs].sort((a, b) => a.vid - b.vid);

    const currentNorm = normalize(
      vlanData.map((v) => ({
        vid: v.vid,
        mbr: v.mbr,
        nm: hexDecode(v.nm),
        igmp: v.igmp,
      })),
    );
    const desiredNorm = normalize(desiredVlans);

    if (!isDeepStrictEqual(currentNorm, desiredNorm)) {
      const added = desiredNorm
        .filter((d) => !currentNorm.find((c) => c.vid === d.vid))
        .map((v) => `+${v.vid}`);
      const removed = currentNorm
        .filter((c) => !desiredNorm.find((d) => d.vid === c.vid))
        .map((v) => `-${v.vid}`);
      const changed = desiredNorm
        .filter((d) => {
          const c = currentNorm.find((c) => c.vid === d.vid);
          return c && !isDeepStrictEqual(c, d);
        })
        .map((v) => `~${v.vid}`);
      logger().info(
        `  vlans: ${[...added, ...removed, ...changed].join(", ") || "reordered"}`,
      );
      if (!dryRun) {
        await client.post(
          "vlan",
          desiredVlans.map((v) => ({
            vid: v.vid,
            mbr: v.mbr,
            nm: v.nm,
            igmp: v.igmp,
          })),
        );
      }
    }
  }

  logger().info(dryRun ? "Dry run complete — no changes written." : "Done.");
}

// ── Dump ──────────────────────────────────────────────────────────────────────

export async function dumpConfig(
  address: string,
  username: string,
  password: string,
) {
  const client = new SwosClient(`http://${address}`, username, password);

  const linkData = (await client.get("link")) as LinkData;
  const fwdData = (await client.get("fwd")) as FwdData;
  const vlanData = (await client.get("vlan")) as VlanEntry[];
  const sysData = (await client.get("sys")) as SysData;

  const numPorts = linkData.nm.length;
  const names = linkData.nm.map(hexDecode);

  const config = {
    system: {
      identity: hexDecode(sysData.id),
    },

    ports: Array.from({ length: numPorts }, (_, i) => ({
      index: i + 1,
      name: names[i],
      enabled: !!(linkData.en & (1 << i)),
      vlan: {
        mode: VLAN_MODES[fwdData.vlan[i]] ?? "optional",
        receive: RECEIVE_MODES[fwdData.vlni[i]] ?? "untagged",
        defaultVlanId: fwdData.dvid[i],
        forceVlanId: !!(fwdData.fvid & (1 << i)),
      },
    })),

    vlans: (vlanData as VlanEntry[])
      .map((v) => ({
        id: v.vid,
        name: hexDecode(v.nm),
        members: fromMask(v.mbr, numPorts),
      }))
      .sort((a, b) => a.id - b.id),
  };

  process.stdout.write(stringifyYaml(config));
}

