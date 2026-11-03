import { parse, stringify } from "yaml";
import type { Device, Model, Port } from "../../model.ts";
import { renderTemplate } from "../../template.ts";
import { readScript, type Profile, type Resolved } from "../context.ts";
import { Client } from "./client.ts";
import { validate } from "./config.ts";
import { apply as applySwos } from "./device.ts";

// a string as the inside of a double-quoted yaml scalar
const quoted = (s: string) => JSON.stringify(s).slice(1, -1);

// what is filled into the template of a switch for one of its ports: where it sends traffic is the
// vlan of an access port, none for a disabled port, and all of them for a trunk
const portValues = (port: Port, device: Device, model: Model) => {
  const idOf = (name: string) => model.vlans.find((v) => v.name === name)!.id;
  // a disabled port is in the device's unused vlan
  const vlanName = port.mode === "off" ? device.unused! : port.vlan!;
  return {
    index: port.index,
    name: quoted(port.name),
    enabled: port.mode !== "off",
    receive: port.mode === "trunk" ? "tagged" : "untagged",
    vlan: port.mode === "trunk" ? 1 : idOf(vlanName),
    force: port.force,
    // a whole line, or nothing
    sfp: port.sfp ? "sfpRateSelect: true" : "",
  };
};

// the same for a vlan: its members follow from the ports
const vlanValues = (name: string, device: Device, model: Model) => {
  const vlan = model.vlans.find((v) => v.name === name)!;
  const members = device.ports
    .filter(
      (p) => p.mode === "trunk" || (p.mode === "access" && p.vlan === name),
    )
    .map((p) => p.index);
  return {
    id: vlan.id,
    name: quoted(vlan.name),
    members: `[${members.join(", ")}]`,
  };
};

export const swos: Profile = {
  extension: ".yaml",

  render: (device, ctx) => {
    const { origin, text } = readScript(device, ctx, swos.extension);
    const parts = text.split(/^---$/m);
    if (parts.length !== 3) {
      throw new Error(
        `${origin}: expected a switch, a port and a vlan, separated by '---'`,
      );
    }
    const [skeleton, port, vlan] = parts;
    const each = <T>(
      items: T[],
      template: string,
      key: string,
      values: (item: T) => object,
    ) =>
      items
        .map((item) =>
          renderTemplate(
            template,
            { device: { name: device.name }, [key]: values(item) },
            origin,
          ),
        )
        .join("");

    const rendered = renderTemplate(
      skeleton,
      {
        device: { name: device.name },
        switch: {
          ports: each(device.ports, port, "port", (p) =>
            portValues(p, device, ctx.model),
          ),
          vlans: each(device.vlans, vlan, "vlan", (v) =>
            vlanValues(v, device, ctx.model),
          ),
        },
      },
      origin,
    );
    // the template is read as the configuration it describes, so a mistake in it is found here
    return stringify(validate(parse(rendered)));
  },

  apply: async (content, o: Resolved) => {
    const config = validate(parse(content));
    const client = new Client(`http://${o.address}`, o.user, o.password ?? "");
    const { plan, ports } = await applySwos(client, config, {
      dryRun: o.dryRun,
    });
    o.log(`${o.address}: ${ports} ports`);
    plan.changes.forEach((change) => o.log(`  ${change}`));
    if (plan.changes.length === 0) {
      o.log("nothing to change");
    } else {
      o.log(o.dryRun ? "dry run: nothing written" : "applied");
    }
  },
};
