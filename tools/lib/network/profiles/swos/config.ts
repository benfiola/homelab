import { isDeepStrictEqual } from "node:util";
import { parseWith, z } from "../../../schema.ts";
import {
  fromMask,
  hasBit,
  hexDecode,
  maxPorts,
  toMask,
  withBit,
} from "./protocol.ts";

export const vlanModes = ["disabled", "optional", "enabled", "strict"] as const;
export const receiveModes = ["any", "tagged", "untagged"] as const;

export type VlanMode = (typeof vlanModes)[number];
export type ReceiveMode = (typeof receiveModes)[number];

// a key that is not known is a typo, or something this does not implement (speed, duplex, the
// switch's own address, lag, snmp): fail rather than ignore it
const checked = z.boolean().optional();
const vlanId = z.number().int().min(1).max(4094);
const portNumber = z.number().int().min(1).max(maxPorts);

const port = z.strictObject({
  index: portNumber,
  name: z.string().optional(),
  enabled: checked,
  autoNegotiation: checked,
  flowControl: z.strictObject({ tx: checked, rx: checked }).optional(),
  sfpRateSelect: checked,
  vlan: z
    .strictObject({
      mode: z.enum(vlanModes).optional(),
      receive: z.enum(receiveModes).optional(),
      defaultVlanId: vlanId.optional(),
      forceVlanId: checked,
    })
    .optional(),
});

const vlan = z.strictObject({
  id: vlanId,
  name: z.string().default(""),
  members: z.array(portNumber),
  portIsolation: checked,
  learning: checked,
  mirror: checked,
  igmpSnooping: checked,
});

const listedOnce = (what: string, values: number[]) => {
  const twice = values.find((v, i) => values.indexOf(v) !== i);
  return twice === undefined ? undefined : `${what} ${twice} is listed twice`;
};

const config = z
  .strictObject({
    system: z.strictObject({ identity: z.string().optional() }).optional(),
    ports: z.array(port).optional(),
    vlans: z.array(vlan).optional(),
  })
  .superRefine((c, ctx) => {
    for (const message of [
      listedOnce(
        "port",
        (c.ports ?? []).map((p) => p.index),
      ),
      listedOnce(
        "vlan",
        (c.vlans ?? []).map((v) => v.id),
      ),
    ]) {
      if (message) ctx.addIssue({ code: "custom", message });
    }
  });

// every field but `index`, `id` and `members` is optional: what is left out is left as the switch has it
export type Port = z.input<typeof port>;
export type Vlan = z.input<typeof vlan>;
export type Config = z.input<typeof config>;

export const validate = (raw: unknown): Config =>
  parseWith(config, raw ?? {}, "config");

// -- what the switch reports (and takes back), by endpoint. strings are hex-encoded

export type State = {
  sys: { id: string; [key: string]: unknown };
  link: {
    nm: string[];
    en: number; // enabled
    an: number; // auto-negotiation
    fctc: number; // flow control, tx
    fctr: number; // flow control, rx
    sfpr: number[]; // sfp rate select, per port
    sfp: number; // how many sfp ports
    sfpo: number; // index of the first
    // forced duplex and speed: not understood, so read and sent back as they were
    dpxc: number;
    spdc: number[];
  };
  fwd: {
    vlan: number[];
    vlni: number[];
    dvid: number[];
    fvid: number; // force vlan id, one bit per port
  };
  vlan: {
    vid: number;
    mbr: number;
    nm: string;
    igmp: number;
    piso: number;
    lrn: number;
    mrr: number;
  }[];
};

export type Write = {
  endpoint: "sys" | "link" | "fwd" | "vlan";
  data: Record<string, unknown> | Record<string, unknown>[];
};

export type Plan = { changes: string[]; writes: Write[] };

const flag = (want: boolean | undefined, have: number): number => {
  if (want === undefined) {
    return have;
  }
  return want ? 1 : 0;
};

// what has to change for the switch to match the config, and the writes that change it
export const plan = (config: Config, state: State): Plan => {
  const changes: string[] = [];
  const writes: Write[] = [];
  const count = state.link.nm.length;

  const exists = (what: string, index: number) => {
    if (index > count) {
      throw new Error(`${what} ${index} is past the switch's ${count} ports`);
    }
  };

  const identity = config.system?.identity;
  if (identity !== undefined) {
    const have = hexDecode(state.sys.id);
    if (have !== identity) {
      changes.push(`system.identity: "${have}" -> "${identity}"`);
      // sys takes partial updates: nothing else is touched
      writes.push({ endpoint: "sys", data: { id: identity } });
    }
  }

  // -- link: names, enabled, auto-negotiation, flow control, sfp rate
  const link = state.link;
  const names = link.nm.map(hexDecode);
  const next = {
    en: link.en,
    an: link.an,
    fctc: link.fctc,
    fctr: link.fctr,
    sfpr: [...link.sfpr],
  };
  let linkChanged = false;
  const bit = (
    key: "en" | "an" | "fctc" | "fctr",
    p: Port,
    want: boolean | undefined,
    label: string,
  ) => {
    if (want === undefined) return;
    const have = hasBit(next[key], p.index - 1);
    if (have === want) return;
    changes.push(`ports[${p.index}].${label}: ${have} -> ${want}`);
    next[key] = withBit(next[key], p.index - 1, want);
    linkChanged = true;
  };
  for (const p of config.ports ?? []) {
    exists("port", p.index);
    if (p.name !== undefined && names[p.index - 1] !== p.name) {
      changes.push(
        `ports[${p.index}].name: "${names[p.index - 1]}" -> "${p.name}"`,
      );
      names[p.index - 1] = p.name;
      linkChanged = true;
    }
    bit("en", p, p.enabled, "enabled");
    bit("an", p, p.autoNegotiation, "autoNegotiation");
    bit("fctc", p, p.flowControl?.tx, "flowControl.tx");
    bit("fctr", p, p.flowControl?.rx, "flowControl.rx");
    if (p.sfpRateSelect !== undefined) {
      const i = p.index - 1;
      if (i < link.sfpo || i >= link.sfpo + link.sfp) {
        throw new Error(
          `port ${p.index} is not an sfp port: sfpRateSelect only applies to those`,
        );
      }
      if (!!next.sfpr[i] !== p.sfpRateSelect) {
        changes.push(
          `ports[${p.index}].sfpRateSelect: ${!!next.sfpr[i]} -> ${p.sfpRateSelect}`,
        );
        next.sfpr[i] = p.sfpRateSelect ? 1 : 0;
        linkChanged = true;
      }
    }
  }
  if (linkChanged) {
    // all the writable fields, always: leaving one out can reset it
    writes.push({
      endpoint: "link",
      data: {
        en: next.en,
        an: next.an,
        nm: names,
        fctc: next.fctc,
        fctr: next.fctr,
        sfpr: next.sfpr,
        dpxc: link.dpxc,
        spdc: link.spdc,
      },
    });
  }

  // -- fwd: per-port vlan handling
  const modes = [...state.fwd.vlan];
  const receives = [...state.fwd.vlni];
  const defaults = [...state.fwd.dvid];
  let fvid = state.fwd.fvid;
  let fwdChanged = false;
  for (const p of config.ports ?? []) {
    const v = p.vlan;
    if (!v) continue;
    const i = p.index - 1;
    if (v.mode !== undefined) {
      const want = vlanModes.indexOf(v.mode);
      if (modes[i] !== want) {
        changes.push(
          `ports[${p.index}].vlan.mode: ${vlanModes[modes[i]] ?? modes[i]} -> ${v.mode}`,
        );
        modes[i] = want;
        fwdChanged = true;
      }
    }
    if (v.receive !== undefined) {
      const want = receiveModes.indexOf(v.receive);
      if (receives[i] !== want) {
        changes.push(
          `ports[${p.index}].vlan.receive: ${receiveModes[receives[i]] ?? receives[i]} -> ${v.receive}`,
        );
        receives[i] = want;
        fwdChanged = true;
      }
    }
    if (v.defaultVlanId !== undefined && defaults[i] !== v.defaultVlanId) {
      changes.push(
        `ports[${p.index}].vlan.defaultVlanId: ${defaults[i]} -> ${v.defaultVlanId}`,
      );
      defaults[i] = v.defaultVlanId;
      fwdChanged = true;
    }
    if (v.forceVlanId !== undefined && hasBit(fvid, i) !== v.forceVlanId) {
      changes.push(
        `ports[${p.index}].vlan.forceVlanId: ${hasBit(fvid, i)} -> ${v.forceVlanId}`,
      );
      fvid = withBit(fvid, i, v.forceVlanId);
      fwdChanged = true;
    }
  }
  if (fwdChanged) {
    writes.push({
      endpoint: "fwd",
      data: { vlan: modes, vlni: receives, dvid: defaults, fvid },
    });
  }

  // -- vlan: the whole table is replaced, so what the config leaves out of a vlan is kept
  if (config.vlans) {
    const wanted = config.vlans.map((v) => {
      const have = state.vlan.find((e) => e.vid === v.id);
      for (const member of v.members) exists(`vlan ${v.id} member`, member);
      return {
        vid: v.id,
        mbr: toMask(v.members),
        nm: v.name ?? "",
        igmp: flag(v.igmpSnooping, have?.igmp ?? 0),
        piso: flag(v.portIsolation, have?.piso ?? 0),
        lrn: flag(v.learning, have?.lrn ?? 1),
        mrr: flag(v.mirror, have?.mrr ?? 0),
      };
    });
    const current = state.vlan.map((v) => ({ ...v, nm: hexDecode(v.nm) }));
    const byId = (a: { vid: number }, b: { vid: number }) => a.vid - b.vid;
    const same = isDeepStrictEqual(
      [...wanted].sort(byId),
      [...current].sort(byId).map(({ vid, mbr, nm, igmp, piso, lrn, mrr }) => ({
        vid,
        mbr,
        nm,
        igmp,
        piso,
        lrn,
        mrr,
      })),
    );
    if (!same) {
      const added = wanted.filter((w) => !current.some((c) => c.vid === w.vid));
      const removed = current.filter(
        (c) => !wanted.some((w) => w.vid === c.vid),
      );
      const changed = wanted.filter((w) => {
        const c = current.find((c) => c.vid === w.vid);
        return (
          c &&
          !isDeepStrictEqual(w, {
            vid: c.vid,
            mbr: c.mbr,
            nm: c.nm,
            igmp: c.igmp,
            piso: c.piso,
            lrn: c.lrn,
            mrr: c.mrr,
          })
        );
      });
      const summary = [
        ...added.map((v) => `+${v.vid}`),
        ...removed.map((v) => `-${v.vid}`),
        ...changed.map((v) => `~${v.vid}`),
      ];
      changes.push(`vlans: ${summary.join(", ") || "reordered"}`);
      writes.push({ endpoint: "vlan", data: wanted });
    }
  }

  return { changes, writes };
};

// the whole state of the switch as a config: edit it, and give it back to `plan`
export const dump = (state: State): Config => {
  const { link, fwd } = state;
  const count = link.nm.length;
  return {
    system: { identity: hexDecode(state.sys.id) },
    ports: Array.from({ length: count }, (_, i): Port => {
      const sfp = i >= link.sfpo && i < link.sfpo + link.sfp;
      return {
        index: i + 1,
        name: hexDecode(link.nm[i]),
        enabled: hasBit(link.en, i),
        autoNegotiation: hasBit(link.an, i),
        flowControl: { tx: hasBit(link.fctc, i), rx: hasBit(link.fctr, i) },
        ...(sfp ? { sfpRateSelect: !!link.sfpr[i] } : {}),
        vlan: {
          mode: vlanModes[fwd.vlan[i]] ?? "optional",
          receive: receiveModes[fwd.vlni[i]] ?? "untagged",
          defaultVlanId: fwd.dvid[i],
          forceVlanId: hasBit(fwd.fvid, i),
        },
      };
    }),
    vlans: state.vlan
      .map((v): Vlan => ({
        id: v.vid,
        name: hexDecode(v.nm),
        members: fromMask(v.mbr, count),
        portIsolation: !!v.piso,
        learning: !!v.lrn,
        mirror: !!v.mrr,
        igmpSnooping: !!v.igmp,
      }))
      .sort((a, b) => a.id - b.id),
  };
};
