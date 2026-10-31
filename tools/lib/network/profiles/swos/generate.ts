import type { Device, Model, Port } from "../../model.ts";

// a string as the inside of a double-quoted yaml scalar
const quoted = (s: string) => JSON.stringify(s).slice(1, -1);

// what is filled into the template of a switch for one of its ports: where it sends traffic is the
// vlan of an access port, none for a disabled port, and all of them for a trunk
export const portValues = (port: Port, device: Device, model: Model) => {
  const idOf = (name: string) => model.vlans.find((v) => v.name === name)!.id;
  return {
    index: port.index,
    name: quoted(port.name),
    enabled: port.mode !== "off",
    receive: port.mode === "trunk" ? "tagged" : "untagged",
    vlan:
      port.mode === "trunk"
        ? 1
        : idOf(port.mode === "off" ? device.unused! : port.vlan!),
    force: port.force,
    // a whole line, or nothing
    sfp: port.sfp ? "sfpRateSelect: true" : "",
  };
};

// the same for a vlan: its members follow from the ports
export const vlanValues = (name: string, device: Device, model: Model) => {
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
