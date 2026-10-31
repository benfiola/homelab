import { join } from "node:path";
import { loadModel, type ProfileName } from "./model.ts";
import { camel, secret, type Context } from "./profiles/context.ts";
import { profiles } from "./profiles/index.ts";
import { clientName } from "./profiles/routeros.ts";
import { wireguardConfig } from "./wireguard.ts";

type Obj = Record<string, any>;

export type OutputKind = ProfileName | "wireguard";

export interface Output {
  file: string;
  profile: OutputKind;
  render: () => string;
}

// everything the network configuration writes: a file for each device, and for each wireguard client
export const listOutputs = (dir: string, secrets: Obj = {}): Output[] => {
  const model = loadModel(dir);
  const ctx: Context = { model, secrets, scripts: join(dir, "scripts") };

  const devices = model.devices.map((device): Output => {
    const profile = profiles[device.profile];
    return {
      file: `${device.name}${profile.extension}`,
      profile: device.profile,
      render: () => profile.render(device, ctx),
    };
  });

  const clients = model.clients.flatMap((client) =>
    client.addresses.map((a): Output => {
      const file = `wireguard.${clientName(client, a.interface)}.conf`;
      const wireguard = model.wireguard.find((w) => w.name === a.interface)!;
      return {
        file,
        profile: "wireguard",
        render: () =>
          wireguardConfig(
            {
              privateKey: secret(
                ctx,
                `wireguard.devices.${camel(client.device)}.${a.interface}.private`,
                file,
              ),
              address: `${a.address}/32`,
              publicKey: secret(
                ctx,
                `wireguard.interfaces.${a.interface}.public`,
                file,
              ),
              port: wireguard.port,
              allowedIps: wireguard.routes,
            },
            { endpoint: `wireguard.${model.domain}`, resolver: model.resolver },
          ) + "\n",
      };
    }),
  );

  const outputs = [...devices, ...clients];
  const files = new Set<string>();
  for (const { file } of outputs) {
    if (files.has(file)) throw new Error(`'${file}' is written twice`);
    files.add(file);
  }
  return outputs;
};

// the content of every output (or those named), by file. the secrets are a mapping the
// scripts and clients reach into, e.g. secrets.wifi.iot.
export const renderNetwork = (
  dir: string,
  secrets: Obj,
  only: string[] = [],
): Record<string, string> => {
  const outputs = listOutputs(dir, secrets);
  for (const name of only) {
    if (!outputs.some((o) => o.file === name)) {
      throw new Error(
        `no output '${name}' (have: ${outputs.map((o) => o.file).join(", ")})`,
      );
    }
  }
  return Object.fromEntries(
    outputs
      .filter((o) => only.length === 0 || only.includes(o.file))
      .map((o) => [o.file, o.render()]),
  );
};
