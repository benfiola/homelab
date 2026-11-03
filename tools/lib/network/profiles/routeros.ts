import { withTempFile } from "../../exec.ts";
import { renderTemplate } from "../template.ts";
import type { Client, Model } from "../model.ts";
import {
  camel,
  readScript,
  secret,
  type Context,
  type Profile,
  type Resolved,
} from "./context.ts";

// a client is named for its device, and for the interface too when it joins several
export const clientName = (client: Client, iface: string) =>
  client.addresses.length > 1 ? `${client.device}-${iface}` : client.device;

const upper = (s: string) => s.toUpperCase();

const reset =
  "/system/reset-configuration no-defaults=yes run-after-reset=script.rsc";

// the parts of the router's script that follow from the model
const blocks = (model: Model, ctx: Context, origin: string) => {
  const wireguardOf = (vlan: string) =>
    model.wireguard.find((w) => w.name === vlan);
  const hosts = [...model.hosts].sort(
    (a, b) =>
      model.vlans.findIndex((v) => v.name === a.vlan) -
        model.vlans.findIndex((v) => v.name === b.vlan) ||
      a.address.localeCompare(b.address, undefined, { numeric: true }),
  );

  return {
    vlanIds: model.vlans.map((v) => v.id).join(","),
    vlanLists: model.vlans.map((v) => upper(v.name)).join(","),
    vlanInterfaces: model.vlans
      .map(
        (v) =>
          `/interface/vlan/add name=${v.name} interface=bridge vlan-id=${v.id}`,
      )
      .join("\n"),
    wireguardPorts: `${Math.min(...model.wireguard.map((w) => w.port))}-${Math.max(...model.wireguard.map((w) => w.port))}`,
    wireguardInterfaces: model.wireguard
      .map(
        (w) =>
          `/interface/wireguard/add name=wg-${w.name} listen-port=${w.port} mtu=1420 private-key="${secret(ctx, `wireguard.interfaces.${w.name}.private`, origin)}"`,
      )
      .join("\n"),
    wireguardPeers: model.vlans
      .flatMap((v) =>
        model.clients.flatMap((c) =>
          c.addresses
            .filter((a) => a.interface === v.name)
            .map(
              (a) =>
                `/interface/wireguard/peers/add allowed-address=${a.address}/32 interface=wg-${a.interface} name=${clientName(c, a.interface)} public-key="${secret(ctx, `wireguard.devices.${camel(c.device)}.${a.interface}.public`, origin)}"`,
            ),
        ),
      )
      .join("\n"),
    interfaceLists: model.vlans
      .flatMap((v) => [
        `/interface/list/add name=${upper(v.name)}`,
        `/interface/list/member/add list=${upper(v.name)} interface=${v.name}`,
        ...(wireguardOf(v.name)
          ? [
              `/interface/list/member/add list=${upper(v.name)} interface=wg-${v.name}`,
            ]
          : []),
      ])
      .join("\n"),
    addresses: model.vlans
      .flatMap((v) => {
        const w = wireguardOf(v.name);
        return [
          `/ip/address/add address=${v.subnet.host(1)}/${v.subnet.prefix} interface=${v.name} network=${v.subnet.network}`,
          ...(w
            ? [
                `/ip/address/add address=${w.subnet.host(1)}/${w.subnet.prefix} interface=wg-${w.name} network=${w.subnet.network}`,
              ]
            : []),
        ];
      })
      .join("\n"),
    pools: model.vlans
      .map(
        (v) =>
          `/ip/pool/add name=${v.name} ranges=${v.subnet.base}.2-${v.subnet.base}.254`,
      )
      .join("\n"),
    dhcpServers: model.vlans
      .map(
        (v) =>
          `/ip/dhcp-server/add name=${v.name} address-pool=${v.name} interface=${v.name} lease-time=10m`,
      )
      .join("\n"),
    dhcpNetworks: model.vlans
      .map(
        (v) =>
          `/ip/dhcp-server/network/add comment=${v.name} address=${v.subnet.cidr} dns-server=${model.resolver} gateway=${v.subnet.host(1)} netmask=${v.subnet.prefix}`,
      )
      .join("\n"),
    leases: hosts
      .map(
        (h) =>
          `/ip/dhcp-server/lease/add address=${h.address} server=${h.vlan} mac-address=${h.mac} comment="${h.name}"`,
      )
      .join("\n"),
    dns: hosts
      .filter((h) => h.dns)
      .map(
        (h) =>
          `/ip/dns/static/add name=${h.name}.${model.domain} address=${h.address} ttl=10m`,
      )
      .join("\n"),
    bgpConnections: hosts
      .filter((h) => h.bgp)
      .map(
        (h) =>
          `/routing/bgp/connection/add instance=cluster name=${h.name} remote.address=${h.address} local.role=ibgp templates=cluster`,
      )
      .join("\n"),
    allowLists: hosts
      .flatMap((h) =>
        h.allow.map(
          (a) =>
            `/ip/firewall/address-list/add list=${upper(h.vlan)}_ALLOW_${upper(a)} address=${h.address} comment="${h.name}"`,
        ),
      )
      .join("\n"),
    ingressLists: model.gateways
      .map(
        (g) =>
          `/ip/firewall/address-list/add list=INFRASTRUCTURE_INGRESS_${upper(g.vlan)} address=${g.address}/32 comment="cluster gateway (${g.vlan})"`,
      )
      .join("\n"),
  };
};

export const routeros: Profile = {
  extension: ".rsc",

  render: (device, ctx) => {
    const { origin, text } = readScript(device, ctx, routeros.extension);
    return renderTemplate(
      text,
      {
        secrets: ctx.secrets,
        device: { name: device.name },
        domain: ctx.model.domain,
        router: blocks(ctx.model, ctx, origin),
      },
      origin,
    );
  },

  apply: async (content, o: Resolved) => {
    const target = `${o.user}@${o.address}`;
    if (o.dryRun) {
      o.log(`would run: scp script.rsc ${target}:script.rsc`);
      o.log(`would run: ssh ${target} ${reset}`);
      o.log("dry run: nothing written");
      return;
    }

    await withTempFile("script.rsc", content, (file) =>
      o.run("scp", [file, `${target}:script.rsc`]),
    );
    if (!o.reset) {
      o.log(
        `copied: reset the router to apply it with\n  ssh -t ${target} ${reset}`,
      );
      return;
    }
    // the router asks before it resets
    await o.run("ssh", ["-t", target, reset], { interactive: true });
    o.log("reset: the router is applying the script and will restart");
  },
};
