import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { parse } from "yaml";
import { listOutputs } from "../../config.ts";
import { Client } from "./client.ts";
import { validate } from "./config.ts";
import { apply, dumpYaml, readState } from "./device.ts";
import { startSwitch, type FakeSwitch } from "./fake.ts";
import { hexDecode } from "./protocol.ts";

const switches: FakeSwitch[] = [];
after(() => Promise.all(switches.map((s) => s.close())));

const connect = async (
  options: Parameters<typeof startSwitch>[0] = {},
  password = options?.password ?? "",
) => {
  const fake = await startSwitch(options);
  switches.push(fake);
  return {
    fake,
    client: new Client(`http://${fake.address}`, "admin", password),
  };
};

const outputs = listOutputs(
  join(import.meta.dirname, "../../../../../network"),
);
const real = (file: string) =>
  validate(parse(outputs.find((o) => o.file === file)!.render()));

describe("apply", () => {
  test("brings a factory-reset switch to the real core switch config", async () => {
    const { fake, client } = await connect();
    const config = real("core.switch.yaml");
    const { plan, ports } = await apply(client, config);
    assert.equal(ports, 18);
    assert.ok(plan.changes.length > 0);
    assert.equal(hexDecode(fake.state.sys.id), "core.switch");

    // the switch matches, and a second run has nothing to do
    const writes = fake.requests.filter((r) => r.startsWith("POST")).length;
    assert.equal(writes, 4);
    assert.deepEqual((await apply(client, config)).plan.changes, []);
    assert.equal(
      fake.requests.filter((r) => r.startsWith("POST")).length,
      writes,
    );
  });

  test("brings it to the cluster switch config, whose vlans differ", async () => {
    const { fake, client } = await connect();
    await apply(client, real("cluster.switch.yaml"));
    assert.equal(hexDecode(fake.state.sys.id), "cluster.switch");
    // the factory vlan 1 is gone: the table is the config
    assert.deepEqual(
      fake.state.vlan
        .map((v) => [v.vid, hexDecode(v.nm)])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
      [
        [8, "family"],
        [16, "personal"],
        [24, "iot"],
        [32, "infrastructure"],
        [88, "management"],
      ],
    );
  });

  test("a dry run writes nothing", async () => {
    const { fake, client } = await connect();
    const { plan } = await apply(client, real("core.switch.yaml"), {
      dryRun: true,
    });
    assert.ok(plan.changes.length > 0);
    assert.deepEqual(
      fake.requests.filter((r) => r.startsWith("POST")),
      [],
    );
    assert.equal(hexDecode(fake.state.sys.id), "MikroTik");
  });

  test("notices a write the switch ignored", async () => {
    const { client } = await connect({ ignore: ["vlan"] });
    await assert.rejects(
      apply(client, real("core.switch.yaml")),
      /did not take every change:\n\s+vlans:/,
    );
  });

  test("answers a password", async () => {
    const { client, fake } = await connect({ password: "hunter2" }, "hunter2");
    await apply(client, { system: { identity: "x" } });
    assert.equal(hexDecode(fake.state.sys.id), "x");
  });

  test("a wrong password is refused", async () => {
    const { fake } = await connect({ password: "hunter2" });
    const wrong = new Client(`http://${fake.address}`, "admin", "");
    await assert.rejects(readState(wrong), /HTTP 401/);
  });
});

describe("dumpYaml", () => {
  test("dumps a switch as a config that applies back to it with nothing to change", async () => {
    const { client } = await connect();
    await apply(client, real("core.switch.yaml"));
    const text = await dumpYaml(client);
    const config = validate(parse(text));
    assert.equal(config.system?.identity, "core.switch");
    assert.deepEqual(
      (await apply(client, config, { dryRun: true })).plan.changes,
      [],
    );
  });

  test("the real configs are what a dump of the switch they make says", async () => {
    const { client } = await connect();
    const wanted = real("core.switch.yaml");
    await apply(client, wanted);
    const got = validate(parse(await dumpYaml(client)));
    // everything the template says, the switch says too
    assert.deepEqual(
      got.ports!.map((p) => ({ ...p, vlan: p.vlan })),
      wanted.ports!.map((p) => ({ ...p, vlan: p.vlan })),
    );
    assert.deepEqual(
      got.vlans,
      wanted.vlans!.map((v) => ({ ...v })).sort((a, b) => a.id - b.id),
    );
  });
});
