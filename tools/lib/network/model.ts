import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseWith, z } from "../schema.ts";
import { isAddress, subnet, type Subnet } from "./ip.ts";

export interface Wifi {
  ssid: string;
  security: "sae" | "psk";
  hidden: boolean;
}

export interface Vlan {
  name: string;
  id: number;
  subnet: Subnet;
  // carried to the access points
  ap: boolean;
  wifi?: Wifi;
}

export interface WireguardInterface {
  name: string;
  port: number;
  subnet: Subnet;
  // what a client routes through the interface, as cidrs
  routes: string[];
}

export interface Client {
  device: string;
  // the interfaces it joins, with its address in each
  addresses: { interface: string; address: string }[];
}

export interface Host {
  name: string;
  vlan: string;
  address: string;
  mac: string;
  dns: boolean;
  allow: string[];
  bgp: boolean;
}

export interface Port {
  index: number;
  name: string;
  mode: "access" | "trunk" | "off";
  // access: the vlan the port is in
  vlan?: string;
  sfp: boolean;
  // access: every frame is put in the vlan, whatever it is tagged with
  force: boolean;
}

export const profiles = ["routeros", "openwrt", "swos"] as const;
export type ProfileName = (typeof profiles)[number];

export interface Device {
  name: string;
  profile: ProfileName;
  // the template of scripts/ the device's configuration is made from
  script?: string;
  // swos: its ports, and the vlans it carries (all, by default)
  ports: Port[];
  vlans: string[];
  // the vlan of a disabled port
  unused?: string;
}

export interface Model {
  domain: string;
  resolver: string;
  vlans: Vlan[];
  // the addresses of the cluster's gateways, by vlan
  gateways: { vlan: string; address: string }[];
  wireguard: WireguardInterface[];
  clients: Client[];
  hosts: Host[];
  devices: Device[];
}

const address = z.string().refine(isAddress, { message: "not an address" });

const cidr = z.string().transform((value, ctx) => {
  try {
    return subnet(value);
  } catch (e: any) {
    ctx.addIssue({ code: "custom", message: e.message });
    return z.NEVER;
  }
});

const mac = z
  .string()
  .regex(
    /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/,
    "not a mac address (AA:BB:CC:DD:EE:FF)",
  );

const octet = z.number().int().min(1).max(254);

// `off` stands for a disabled port
const port = z.preprocess(
  (v) => (v === "off" ? { off: true } : v),
  z
    .strictObject({
      off: z.boolean().default(false),
      name: z.string().default(""),
      access: z.string().optional(),
      trunk: z.boolean().default(false),
      sfp: z.boolean().default(false),
      force: z.boolean().default(false),
    })
    .refine(
      (p) => (p.off ? !p.access && !p.trunk : Boolean(p.access) !== p.trunk),
      "needs exactly one of 'access' and 'trunk', or to be 'off'",
    ),
);

const schema = z.strictObject({
  domain: z.string(),
  resolver: address,
  vlans: z.record(
    z.string(),
    z.strictObject({
      id: z.number().int().min(1).max(4094),
      subnet: cidr,
      ap: z.boolean().default(true),
      wifi: z
        .strictObject({
          ssid: z.string(),
          security: z.enum(["sae", "psk"]),
          hidden: z.boolean().default(false),
        })
        .optional(),
    }),
  ),
  gateways: z.record(z.string(), address),
  wireguard: z.record(
    z.string(),
    z.strictObject({
      port: z.number().int().min(1).max(65535),
      subnet: cidr,
      routes: z.array(z.string()),
    }),
  ),
  clients: z.record(z.string(), z.record(z.string(), octet)),
  hosts: z.array(
    z.strictObject({
      vlan: z.string(),
      ip: octet,
      name: z.string(),
      mac,
      dns: z.boolean().default(false),
      allow: z.array(z.string()).default([]),
      bgp: z.boolean().default(false),
    }),
  ),
  devices: z.record(
    z.string(),
    z.strictObject({
      profile: z.enum(profiles),
      script: z.string(),
      ports: z.record(z.string(), port).optional(),
      vlans: z.array(z.string()).optional(),
      unused: z.string().optional(),
    }),
  ),
});

const known = (what: string, names: string[], name: string, path: string) => {
  if (!names.includes(name)) {
    throw new Error(
      `${path}: no ${what} '${name}' (have: ${names.join(", ")})`,
    );
  }
};

// what the schema doesn't say: the names things refer to must be there, and the addresses they
// give must be within the networks they are in
export const loadModel = (dir: string): Model => {
  const file = join(dir, "network.yaml");
  const raw = parseWith(schema, parse(readFileSync(file, "utf-8")), file);
  const at = (key: string) => `${file}:${key}`;

  const vlans = Object.entries(raw.vlans)
    .map(([name, v]): Vlan => ({ name, ...v }))
    .sort((a, b) => a.id - b.id);
  const vlanNames = vlans.map((v) => v.name);
  const vlan = (name: string, path: string) => {
    known("vlan", vlanNames, name, path);
    return vlans.find((v) => v.name === name)!;
  };

  const gateways = Object.entries(raw.gateways).map(([name, ip]) => {
    vlan(name, at("gateways"));
    return { vlan: name, address: ip };
  });

  const wireguard = Object.entries(raw.wireguard)
    .map(([name, w]): WireguardInterface => {
      vlan(name, at("wireguard"));
      return {
        name,
        port: w.port,
        subnet: w.subnet,
        // `gateway:<vlan>` is that gateway's address
        routes: w.routes.map((route) => {
          if (!route.startsWith("gateway:")) return route;
          const g = gateways.find((x) => x.vlan === route.slice(8));
          if (!g) {
            throw new Error(
              `${at("wireguard")}.${name}: no gateway '${route}'`,
            );
          }
          return `${g.address}/32`;
        }),
      };
    })
    .sort((a, b) => a.port - b.port);

  const clients = Object.entries(raw.clients).map(
    ([device, joined]): Client => ({
      device,
      addresses: Object.entries(joined).map(([name, last]) => {
        const w = wireguard.find((x) => x.name === name);
        if (!w) {
          throw new Error(
            `${at("clients")}.${device}: no wireguard interface '${name}'`,
          );
        }
        return { interface: name, address: w.subnet.host(last) };
      }),
    }),
  );

  const hosts = raw.hosts.map((h, i): Host => {
    const net = vlan(h.vlan, `${at("hosts")}[${i}]`);
    return {
      name: h.name,
      vlan: net.name,
      address: net.subnet.host(h.ip),
      mac: h.mac,
      dns: h.dns,
      allow: h.allow,
      bgp: h.bgp,
    };
  });

  const devices = Object.entries(raw.devices).map(([name, d]): Device => {
    const where = `${at("devices")}.${name}`;
    if (d.profile === "swos") {
      if (!d.ports) throw new Error(`${where}: a swos device needs 'ports'`);
    } else if (d.ports || d.vlans || d.unused) {
      throw new Error(`${where}: only a swos device has ports and vlans`);
    }
    const names = d.vlans ?? vlanNames;
    names.forEach((n) => vlan(n, where));
    if (d.unused) vlan(d.unused, where);
    const ports = Object.entries(d.ports ?? {}).map(([key, p]): Port => {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 1 || index > 32) {
        throw new Error(
          `${where}.ports.${key}: a port is numbered from 1 to 32`,
        );
      }
      if (p.access && !names.includes(p.access)) {
        throw new Error(
          `${where}.ports.${key}: vlan '${p.access}' is not one of the device's vlans`,
        );
      }
      if (p.off && !d.unused) {
        throw new Error(
          `${where}: a disabled port needs the device's 'unused' vlan`,
        );
      }
      return {
        index,
        name: p.off ? "" : p.name,
        mode: p.off ? "off" : p.trunk ? "trunk" : "access",
        vlan: p.access,
        sfp: p.sfp,
        force: p.force,
      };
    });
    return {
      name,
      profile: d.profile,
      script: d.script,
      ports: ports.sort((a, b) => a.index - b.index),
      vlans: names,
      unused: d.unused,
    };
  });

  return {
    domain: raw.domain,
    resolver: raw.resolver,
    vlans,
    gateways,
    wireguard,
    clients,
    hosts,
    devices,
  };
};
