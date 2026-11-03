import { renderTemplate } from "../template.ts";
import type { Model } from "../model.ts";
import {
  readScript,
  secret,
  type Context,
  type Profile,
  type Resolved,
} from "./context.ts";

// the script is kept in memory, which a reboot clears: it has secrets in it
const script = "/tmp/homelab.sh";

const bands = [
  ["2g", "radio0"],
  ["5g", "radio1"],
] as const;

// the parts of an access point's script that follow from the vlans
const blocks = (model: Model, ctx: Context, origin: string) => {
  const carried = model.vlans.filter((v) => v.ap);
  const networks = carried.filter((v) => v.wifi);
  return {
    bridgeDevices: carried
      .flatMap((v) => [
        "add network device",
        "set network.@device[-1]=device",
        "set network.@device[-1].type='bridge'",
        `set network.@device[-1].name='br-${v.name}'`,
        `set network.@device[-1].ports='br-trunk.${v.id}'`,
      ])
      .join("\n"),
    bridgeVlans: carried
      .flatMap((v) => [
        "add network bridge-vlan",
        "set network.@bridge-vlan[-1]=bridge-vlan",
        "set network.@bridge-vlan[-1].device='br-trunk'",
        `set network.@bridge-vlan[-1].vlan='${v.id}'`,
        "add_list network.@bridge-vlan[-1].ports='eth1:t'",
      ])
      .join("\n"),
    interfaces: networks
      .flatMap((v) => [
        `set network.${v.name}=interface`,
        `set network.${v.name}.proto='none'`,
        `set network.${v.name}.device='br-${v.name}'`,
        `set network.${v.name}.multipath='off'`,
      ])
      .join("\n"),
    wireless: networks
      .flatMap((v) =>
        bands.flatMap(([band, radio]) => {
          const w = v.wifi!;
          const id = `wireless.${v.name}${band}`;
          return [
            `set ${id}=wifi-iface`,
            `set ${id}.device='${radio}'`,
            `set ${id}.mode='ap'`,
            `set ${id}.ssid='${w.ssid}'`,
            `set ${id}.encryption='${w.security}-mixed'`,
            `set ${id}.key='${secret(ctx, `wifi.${v.name}`, origin)}'`,
            `set ${id}.ieee80211r='1'`,
            `set ${id}.ft_over_ds='0'`,
            ...(w.security === "sae" ? [`set ${id}.ocv='0'`] : []),
            `set ${id}.network='${v.name}'`,
            ...(w.security === "psk"
              ? [`set ${id}.ft_psk_generate_local='1'`]
              : []),
            `set ${id}.reassociation_deadline='20000'`,
            ...(w.hidden ? [`set ${id}.hidden='1'`] : []),
          ];
        }),
      )
      .join("\n"),
  };
};

export const openwrt: Profile = {
  extension: ".sh",

  render: (device, ctx) => {
    const { origin, text } = readScript(device, ctx, openwrt.extension);
    return renderTemplate(
      text,
      {
        secrets: ctx.secrets,
        device: { name: device.name },
        ap: blocks(ctx.model, ctx, origin),
      },
      origin,
    );
  },

  apply: async (content, o: Resolved) => {
    const target = `${o.user}@${o.address}`;
    const steps: [string, string[], { input?: string }][] = [
      ["ssh", [target, `umask 077 && cat > ${script}`], { input: content }],
      [
        "ssh",
        [target, `sh ${script}; status=$?; rm -f ${script}; exit $status`],
        {},
      ],
    ];
    for (const [command, args, options] of steps) {
      if (o.dryRun) o.log(`would run: ${command} ${args.join(" ")}`);
      else await o.run(command, args, options);
    }
    o.log(
      o.dryRun
        ? "dry run: nothing written"
        : "applied: set the admin password in the web ui, and reboot the device",
    );
  },
};
