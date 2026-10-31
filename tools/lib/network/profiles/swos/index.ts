import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { checkTemplate, renderTemplate } from "../../template.ts";
import type { Profile, Resolved } from "../context.ts";
import { Client } from "./client.ts";
import { validate } from "./config.ts";
import { apply as applySwos } from "./device.ts";
import { portValues, vlanValues } from "./generate.ts";

export const swos: Profile = {
  extension: ".yaml",

  render: (device, ctx) => {
    const origin = `${device.name}.yaml (${device.script})`;
    const text = readFileSync(join(ctx.scripts, device.script!), "utf-8");
    checkTemplate(text, origin);
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
    o.log(
      plan.changes.length === 0
        ? "nothing to change"
        : o.dryRun
          ? "dry run: nothing written"
          : "applied",
    );
  },
};
