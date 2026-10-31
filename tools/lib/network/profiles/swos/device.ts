import { stringify } from "yaml";
import type { Client } from "./client.ts";
import { dump, plan, type Config, type Plan, type State } from "./config.ts";

// one request at a time: the client's digest nonce count is not shared between requests in flight
export const readState = async (client: Client): Promise<State> => {
  const link = await client.get("link");
  const fwd = await client.get("fwd");
  const vlan = await client.get("vlan");
  const sys = await client.get("sys");
  return { link, fwd, vlan, sys } as State;
};

export type ApplyResult = { plan: Plan; ports: number };

// brings the switch to the config. the switch is read again afterwards: SwOS answers a write it
// ignored just as it answers one it took
export const apply = async (
  client: Client,
  config: Config,
  options: { dryRun?: boolean } = {},
): Promise<ApplyResult> => {
  const state = await readState(client);
  const result = plan(config, state);
  if (options.dryRun) return { plan: result, ports: state.link.nm.length };

  for (const write of result.writes) {
    await client.post(write.endpoint, write.data);
  }
  if (result.writes.length) {
    const left = plan(config, await readState(client)).changes;
    if (left.length) {
      throw new Error(
        `the switch did not take every change:\n${left.map((c) => `  ${c}`).join("\n")}`,
      );
    }
  }
  return { plan: result, ports: state.link.nm.length };
};

export const dumpYaml = async (client: Client): Promise<string> =>
  stringify(dump(await readState(client)));
