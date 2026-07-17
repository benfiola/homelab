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
 * Set/clear bit `i` in `mask` to match `desired`, logging the change. Returns
 * `mask` unchanged if `desired` is undefined or already matches.
 */
function applyBit(
  mask: number,
  i: number,
  desired: boolean | undefined,
  label: string,
): number {
  if (desired === undefined) return mask;
  const cur = !!(mask & (1 << i));
  if (cur === desired) return mask;
  logger().info(`  ${label}: ${cur} → ${desired}`);
  return desired ? mask | (1 << i) : mask & ~(1 << i);
}

/** Resolve a VLAN-level flag: explicit config value if set, else the existing switch value. */
function resolveFlag(desired: boolean | undefined, fallback: number): number {
  return desired !== undefined ? (desired ? 1 : 0) : fallback;
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

// .strict() everywhere below: an unrecognized key is almost always either a
// typo or a feature swos.ts doesn't implement (e.g. speed/duplex, cip, aci,
// lag, snmp) — fail loudly rather than silently ignoring it.

const portConfigSchema = zod
  .object({
    /** 1-based port index */
    index: zod.number().int().min(1),
    name: zod.string().optional(),
    enabled: zod.boolean().optional(),
    autoNegotiation: zod.boolean().optional(),
    flowControl: zod
      .object({
        tx: zod.boolean().optional(),
        rx: zod.boolean().optional(),
      })
      .strict()
      .optional(),
    /** SFP rate select — only applicable to SFP ports (see sys/link SFP range) */
    sfpRateSelect: zod.boolean().optional(),
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
      .strict()
      .optional(),
  })
  .strict();

const vlanConfigSchema = zod
  .object({
    id: zod.number().int().min(1).max(4094),
    name: zod.string().default(""),
    /** 1-based port indices that are members of this VLAN */
    members: zod.array(zod.number().int().min(1)),
    /** Isolate member ports of this VLAN from each other */
    portIsolation: zod.boolean().optional(),
    /** MAC address learning enabled for this VLAN */
    learning: zod.boolean().optional(),
    /** Mirror this VLAN's traffic to the configured mirror-to port */
    mirror: zod.boolean().optional(),
    /** IGMP snooping enabled for this VLAN */
    igmpSnooping: zod.boolean().optional(),
  })
  .strict();

const configSchema = zod
  .object({
    system: zod
      .object({
        identity: zod.string().optional(),
      })
      .strict()
      .optional(),
    ports: zod.array(portConfigSchema).optional(),
    vlans: zod.array(vlanConfigSchema).optional(),
  })
  .strict();

type Config = zod.infer<typeof configSchema>;
type PortConfig = zod.infer<typeof portConfigSchema>;

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
  /** Auto-negotiation enabled, per-port bitmask */
  an: number;
  /** TX flow control enabled, per-port bitmask */
  fctc: number;
  /** RX flow control enabled, per-port bitmask */
  fctr: number;
  /** SFP rate select, one entry per port (only meaningful for SFP ports) */
  sfpr: number[];
  /** Number of SFP ports */
  sfp: number;
  /** 0-based index of the first SFP port */
  sfpo: number;
  /**
   * Forced duplex config, per-port bitmask — only meaningful when `an` is off
   * for that port. Semantics unconfirmed; read and preserved verbatim on
   * every POST, never interpreted.
   */
  dpxc: number;
  /**
   * Forced speed config, one entry per port — only meaningful when `an` is
   * off for that port. Semantics unconfirmed; read and preserved verbatim on
   * every POST, never interpreted.
   */
  spdc: number[];
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
  /** IGMP snooping: 0=off, 1=on (single toggle for the whole VLAN, not per-port) */
  igmp: number;
  /** Port isolation: 0=off, 1=on (single toggle for the whole VLAN, not per-port) */
  piso: number;
  /** MAC address learning: 0=off, 1=on (single toggle for the whole VLAN, not per-port) */
  lrn: number;
  /** Mirroring: 0=off, 1=on (single toggle for the whole VLAN, not per-port) */
  mrr: number;
};

type SysData = {
  id: string;
  [key: string]: unknown;
};

/** Applies port names, enabled state, auto-negotiation, flow control, and SFP rate select. */
async function applyPortLinkSettings(
  client: SwosClient,
  ports: PortConfig[] | undefined,
  linkData: LinkData,
  numPorts: number,
  dryRun: boolean,
): Promise<void> {
  if (!ports) return;

  const names = linkData.nm.map(hexDecode);
  const newNames = [...names];
  let newEnabled = linkData.en;
  let newAn = linkData.an;
  let newFctc = linkData.fctc;
  let newFctr = linkData.fctr;
  const newSfpr = [...linkData.sfpr];
  let linkChanged = false;

  const isSfpPort = (i: number) =>
    i >= linkData.sfpo && i < linkData.sfpo + linkData.sfp;

  for (const p of ports) {
    const i = p.index - 1;
    if (i >= numPorts)
      throw new Error(`Port index ${p.index} exceeds switch port count ${numPorts}`);

    if (p.name !== undefined && newNames[i] !== p.name) {
      logger().info(`  port[${p.index}].name: "${newNames[i]}" → "${p.name}"`);
      newNames[i] = p.name;
      linkChanged = true;
    }

    const prevEnabled = newEnabled;
    newEnabled = applyBit(newEnabled, i, p.enabled, `port[${p.index}].enabled`);
    if (newEnabled !== prevEnabled) linkChanged = true;

    const prevAn = newAn;
    newAn = applyBit(newAn, i, p.autoNegotiation, `port[${p.index}].autoNegotiation`);
    if (newAn !== prevAn) linkChanged = true;

    const prevFctc = newFctc;
    newFctc = applyBit(newFctc, i, p.flowControl?.tx, `port[${p.index}].flowControl.tx`);
    if (newFctc !== prevFctc) linkChanged = true;

    const prevFctr = newFctr;
    newFctr = applyBit(newFctr, i, p.flowControl?.rx, `port[${p.index}].flowControl.rx`);
    if (newFctr !== prevFctr) linkChanged = true;

    if (p.sfpRateSelect !== undefined) {
      if (!isSfpPort(i))
        throw new Error(
          `Port index ${p.index} is not an SFP port — sfpRateSelect only applies to SFP ports`,
        );
      const cur = !!newSfpr[i];
      if (cur !== p.sfpRateSelect) {
        logger().info(
          `  port[${p.index}].sfpRateSelect: ${cur} → ${p.sfpRateSelect}`,
        );
        newSfpr[i] = p.sfpRateSelect ? 1 : 0;
        linkChanged = true;
      }
    }
  }

  if (linkChanged && !dryRun) {
    await client.post("link", {
      en: newEnabled,
      an: newAn,
      nm: newNames,
      fctc: newFctc,
      fctr: newFctr,
      sfpr: newSfpr,
      // Unconfirmed semantics — echoed back verbatim so we never touch them.
      dpxc: linkData.dpxc,
      spdc: linkData.spdc,
    });
  }
}

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

  // ── Port names, enabled, auto-negotiation, flow control, SFP rate ───────────
  await applyPortLinkSettings(client, config.ports, linkData, numPorts, dryRun);

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

      const prevFvid = fvid;
      fvid = applyBit(fvid, i, p.vlan.forceVlanId, `port[${p.index}].vlan.forceVlanId`);
      if (fvid !== prevFvid) fwdChanged = true;
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
    const desiredVlans = config.vlans.map((v) => {
      const existing = vlanData.find((e) => e.vid === v.id);
      return {
        vid: v.id,
        mbr: toMask(v.members),
        nm: v.name,
        igmp: resolveFlag(v.igmpSnooping, existing?.igmp ?? 0),
        piso: resolveFlag(v.portIsolation, existing?.piso ?? 0),
        lrn: resolveFlag(v.learning, existing?.lrn ?? 1),
        mrr: resolveFlag(v.mirror, existing?.mrr ?? 0),
      };
    });

    // Normalize both sides for comparison
    const normalize = (vs: typeof desiredVlans) =>
      [...vs].sort((a, b) => a.vid - b.vid);

    const currentNorm = normalize(
      vlanData.map((v) => ({
        vid: v.vid,
        mbr: v.mbr,
        nm: hexDecode(v.nm),
        igmp: v.igmp,
        piso: v.piso,
        lrn: v.lrn,
        mrr: v.mrr,
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
            piso: v.piso,
            lrn: v.lrn,
            mrr: v.mrr,
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
      autoNegotiation: !!(linkData.an & (1 << i)),
      flowControl: {
        tx: !!(linkData.fctc & (1 << i)),
        rx: !!(linkData.fctr & (1 << i)),
      },
      ...(i >= linkData.sfpo && i < linkData.sfpo + linkData.sfp
        ? { sfpRateSelect: !!linkData.sfpr[i] }
        : {}),
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
        portIsolation: !!v.piso,
        learning: !!v.lrn,
        mirror: !!v.mrr,
        igmpSnooping: !!v.igmp,
      }))
      .sort((a, b) => a.id - b.id),
  };

  process.stdout.write(stringifyYaml(config));
}

