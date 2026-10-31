import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { parse } from "yaml";
import { listOutputs } from "../../config.ts";
import { dump, plan, validate, type Config } from "./config.ts";
import { factory } from "./fake.ts";

describe("validate", () => {
  test("accepts a config", () => {
    const config = validate({
      system: { identity: "core" },
      ports: [
        {
          index: 1,
          name: "a",
          flowControl: { tx: true },
          vlan: { mode: "strict", receive: "untagged", defaultVlanId: 8 },
        },
      ],
      vlans: [{ id: 8, members: [1] }],
    });
    assert.equal(config.vlans![0].name, "");
  });

  test("an empty config is a config", () => {
    assert.deepEqual(validate(null), {});
  });

  test("names the path of what is wrong", () => {
    const bad = (config: unknown, message: RegExp) =>
      assert.throws(() => validate(config), message);
    bad({ speed: 1 }, /config: Unrecognized key: "speed"/);
    bad(
      { ports: [{ index: 1, speed: 1000 }] },
      /config\.ports\[0\]: Unrecognized key: "speed"/,
    );
    bad(
      { ports: [{ name: "a" }] },
      /config\.ports\[0\]\.index: Invalid input: expected number, received undefined/,
    );
    bad(
      { ports: [{ index: 0 }] },
      /config\.ports\[0\]\.index: Too small: expected number to be >=1/,
    );
    bad(
      { ports: [{ index: 1, vlan: { mode: "loose" } }] },
      /config\.ports\[0\]\.vlan\.mode: Invalid option: expected one of "disabled"\|"optional"\|"enabled"\|"strict"/,
    );
    bad(
      { vlans: [{ id: 5000, members: [] }] },
      /config\.vlans\[0\]\.id: Too big: expected number to be <=4094/,
    );
    bad(
      { vlans: [{ id: 5 }] },
      /config\.vlans\[0\]\.members: Invalid input: expected array/,
    );
    bad(
      { ports: [{ index: 1, enabled: "yes" }] },
      /config\.ports\[0\]\.enabled: Invalid input: expected boolean, received string/,
    );
    bad({ ports: "none" }, /config\.ports: Invalid input: expected array/);
  });

  test("rejects a port or vlan listed twice", () => {
    assert.throws(
      () => validate({ ports: [{ index: 1 }, { index: 1 }] }),
      /port 1 is listed twice/,
    );
    assert.throws(
      () =>
        validate({
          vlans: [
            { id: 8, members: [] },
            { id: 8, members: [] },
          ],
        }),
      /vlan 8 is listed twice/,
    );
  });
});

describe("plan", () => {
  test("a switch that matches has nothing to change", () => {
    const state = factory();
    assert.deepEqual(plan(dump(state), state), { changes: [], writes: [] });
  });

  test("changes the identity, alone", () => {
    const result = plan({ system: { identity: "core.switch" } }, factory());
    assert.deepEqual(result.changes, [
      'system.identity: "MikroTik" -> "core.switch"',
    ]);
    assert.deepEqual(result.writes, [
      { endpoint: "sys", data: { id: "core.switch" } },
    ]);
  });

  test("changes link settings, and sends every writable field with them", () => {
    const state = factory();
    const result = plan(
      {
        ports: [
          { index: 2, name: "nas", enabled: false, flowControl: { rx: false } },
        ],
      },
      state,
    );
    assert.deepEqual(result.changes, [
      'ports[2].name: "Port2" -> "nas"',
      "ports[2].enabled: true -> false",
      "ports[2].flowControl.rx: true -> false",
    ]);
    assert.equal(result.writes.length, 1);
    const data = result.writes[0].data as Record<string, any>;
    assert.equal(result.writes[0].endpoint, "link");
    assert.equal(data.en, 0x3ffff & ~2);
    assert.equal(data.fctr, 0x3ffff & ~2);
    assert.equal(data.nm[1], "nas");
    assert.equal(data.nm[0], "Port1");
    // fields that aren't understood are sent back unchanged
    assert.equal(data.dpxc, state.link.dpxc);
    assert.deepEqual(data.spdc, state.link.spdc);
  });

  test("changes per-port vlan handling", () => {
    const result = plan(
      {
        ports: [
          {
            index: 3,
            vlan: {
              mode: "strict",
              receive: "untagged",
              defaultVlanId: 32,
              forceVlanId: true,
            },
          },
        ],
      },
      factory(),
    );
    assert.deepEqual(result.changes, [
      "ports[3].vlan.mode: optional -> strict",
      "ports[3].vlan.receive: any -> untagged",
      "ports[3].vlan.defaultVlanId: 1 -> 32",
      "ports[3].vlan.forceVlanId: false -> true",
    ]);
    const data = result.writes[0].data as Record<string, any>;
    assert.equal(result.writes[0].endpoint, "fwd");
    assert.equal(data.vlan[2], 3);
    assert.equal(data.vlni[2], 2);
    assert.equal(data.dvid[2], 32);
    assert.equal(data.fvid, 4);
    assert.equal(data.vlan[0], 1);
  });

  test("replaces the vlan table, keeping the flags the config leaves out", () => {
    const state = factory();
    state.vlan[0].igmp = 1;
    const result = plan(
      {
        vlans: [
          { id: 1, name: "default", members: [1, 2], portIsolation: true },
          { id: 8, name: "users", members: [3] },
        ],
      },
      state,
    );
    assert.deepEqual(result.changes, ["vlans: +8, ~1"]);
    assert.deepEqual(result.writes[0].data, [
      { vid: 1, mbr: 3, nm: "default", igmp: 1, piso: 1, lrn: 1, mrr: 0 },
      { vid: 8, mbr: 4, nm: "users", igmp: 0, piso: 0, lrn: 1, mrr: 0 },
    ]);
  });

  test("a vlan left out of the config is removed", () => {
    const result = plan({ vlans: [{ id: 8, members: [1] }] }, factory());
    assert.deepEqual(result.changes, ["vlans: +8, -1"]);
  });

  test("the order of the vlan table is not a difference", () => {
    const state = factory();
    state.vlan.push({ ...state.vlan[0], vid: 8 });
    const config = dump(state);
    config.vlans!.reverse();
    assert.deepEqual(plan(config, state).changes, []);
  });

  test("refuses ports the switch does not have", () => {
    assert.throws(
      () => plan({ ports: [{ index: 19 }] }, factory()),
      /port 19 is past the switch's 18 ports/,
    );
    assert.throws(
      () => plan({ vlans: [{ id: 8, members: [19] }] }, factory()),
      /vlan 8 member 19 is past/,
    );
  });

  test("sfp rate select is for sfp ports only", () => {
    assert.throws(
      () => plan({ ports: [{ index: 1, sfpRateSelect: true }] }, factory()),
      /port 1 is not an sfp port/,
    );
    const result = plan(
      { ports: [{ index: 17, sfpRateSelect: true }] },
      factory(),
    );
    assert.deepEqual(result.changes, [
      "ports[17].sfpRateSelect: false -> true",
    ]);
    assert.equal((result.writes[0].data as any).sfpr[16], 1);
  });
});

describe("dump", () => {
  test("describes the whole switch", () => {
    const config = dump(factory());
    assert.equal(config.system?.identity, "MikroTik");
    assert.equal(config.ports!.length, 18);
    assert.equal(config.ports![0].name, "Port1");
    assert.equal(config.ports![0].vlan?.mode, "optional");
    assert.equal(config.ports![0].vlan?.receive, "any");
    assert.equal("sfpRateSelect" in config.ports![0], false);
    assert.equal(config.ports![17].sfpRateSelect, false);
    assert.deepEqual(config.vlans![0].members.length, 18);
  });

  test("is a valid config", () => {
    const config = dump(factory());
    const reread = validate(JSON.parse(JSON.stringify(config)));
    assert.deepEqual(
      JSON.parse(JSON.stringify(reread)),
      JSON.parse(JSON.stringify(config)),
    );
  });
});

describe("the switches in network/", () => {
  const switches = listOutputs(
    join(import.meta.dirname, "../../../../../network"),
  ).filter((o) => o.profile === "swos");

  test("there are some", () => assert.ok(switches.length >= 2));

  for (const output of switches) {
    test(`${output.file} is a config for a switch of its size`, () => {
      const config: Config = validate(parse(output.render()));
      const result = plan(config, factory());
      // a factory-reset switch changes in every endpoint
      assert.deepEqual(
        result.writes.map((w) => w.endpoint),
        ["sys", "link", "fwd", "vlan"],
      );
    });
  }
});
