import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { files, remove, workspace } from "./fixture.ts";
import { loadModel } from "./model.ts";

const dirs: string[] = [];
after(() => remove(dirs));

// the fixture, with one of its lines changed
const changed = (from: string, to: string) => {
  const network = files["network.yaml"];
  assert.ok(network.includes(from), `${from} is in the fixture`);
  return loadModel(
    workspace({ ...files, "network.yaml": network.replace(from, to) }, dirs),
  );
};

describe("loadModel", () => {
  const model = loadModel(workspace(files, dirs));

  test("orders vlans by id, and wireguard interfaces by port", () => {
    assert.deepEqual(
      model.vlans.map((v) => v.name),
      ["home", "iot", "servers", "management"],
    );
    assert.deepEqual(
      model.wireguard.map((w) => w.name),
      ["home", "servers"],
    );
  });

  test("a host's address is within its vlan", () => {
    assert.deepEqual(
      model.hosts.map((h) => h.address),
      ["10.0.8.2", "10.0.24.2", "10.0.32.2"],
    );
  });

  test("a client's address is within the interface's network", () => {
    assert.deepEqual(model.clients[0].addresses, [
      { interface: "home", address: "10.9.0.2" },
      { interface: "servers", address: "10.9.1.2" },
    ]);
  });

  test("a route can name a gateway", () => {
    assert.deepEqual(model.wireguard[0].routes, [
      "10.0.33.2/32",
      "10.0.88.1/32",
    ]);
  });

  test("a vlan is carried to the access points, unless it says not", () => {
    assert.deepEqual(
      model.vlans.map((v) => v.ap),
      [true, true, false, true],
    );
  });

  test("a switch's ports are in order, and its vlans default to all of them", () => {
    const [, , core] = model.devices;
    assert.deepEqual(
      core.ports.map((p) => [p.index, p.mode]),
      [
        [1, "access"],
        [2, "access"],
        [3, "off"],
        [4, "access"],
        [17, "trunk"],
      ],
    );
    assert.deepEqual(core.vlans, ["home", "iot", "management"]);
    assert.equal(core.ports[3].force, true);
    assert.equal(core.ports[4].sfp, true);
  });

  test("a switch without vlans of its own carries them all", () => {
    const m = changed("    vlans: [home, iot, management]\n", "");
    assert.deepEqual(m.devices[2].vlans, [
      "home",
      "iot",
      "servers",
      "management",
    ]);
  });
});

describe("loadModel refuses", () => {
  const fails = (from: string, to: string, message: RegExp) =>
    assert.throws(() => changed(from, to), message);

  test("a key it doesn't know", () => {
    fails(
      "domain: example.test",
      "domain: example.test\nspeed: 1",
      /Unrecognized key: "speed"/,
    );
  });

  test("a vlan that isn't there", () => {
    fails(
      "{ vlan: home, ip: 2, name: desk",
      "{ vlan: nope, ip: 2, name: desk",
      /no vlan 'nope' \(have: home, iot, servers, management\)/,
    );
    fails("  home: 10.0.33.2", "  nope: 10.0.33.2", /no vlan 'nope'/);
    fails("  home: { port: 13001", "  nope: { port: 13001", /no vlan 'nope'/);
  });

  test("a client on an interface that isn't there", () => {
    fails(
      "phone: { home: 3 }",
      "phone: { nope: 3 }",
      /no wireguard interface 'nope'/,
    );
  });

  test("a route to a gateway that isn't there", () => {
    fails("[gateway:home,", "[gateway:nope,", /no gateway 'gateway:nope'/);
  });

  test("a subnet that is not a network", () => {
    fails("subnet: 10.0.8.0/24", "subnet: 10.0.8.1/24", /host bits set/);
  });

  test("a mac address that isn't one", () => {
    fails("AA:BB:CC:DD:EE:01", "AA:BB:CC", /not a mac address/);
  });

  test("a device without its script", () => {
    fails(
      "router: { profile: routeros, script: router.rsc }",
      "router: { profile: routeros }",
      /devices\.router\.script: Invalid input: expected string/,
    );
    fails(
      "    script: switch.yaml\n",
      "",
      /devices\.core\.switch\.script: Invalid input: expected string/,
    );
  });

  test("a port that is both or neither access and trunk", () => {
    fails(
      "2: { name: desk, access: home }",
      "2: { name: desk, access: home, trunk: true }",
      /exactly one of 'access' and 'trunk'/,
    );
    fails(
      "2: { name: desk, access: home }",
      "2: { name: desk }",
      /exactly one of 'access' and 'trunk'/,
    );
  });

  test("a port in a vlan the switch doesn't carry", () => {
    fails(
      "2: { name: desk, access: home }",
      "2: { name: desk, access: servers }",
      /vlan 'servers' is not one of the device's vlans/,
    );
  });

  test("a disabled port without a vlan to put it in", () => {
    fails("    unused: home\n", "", /needs the device's 'unused' vlan/);
  });

  test("ports, vlans, or a vlan for unused ports, on a device that is not a switch", () => {
    for (const extra of ["ports: {}", "vlans: [home]", "unused: home"]) {
      fails(
        "router: { profile: routeros, script: router.rsc }",
        `router: { profile: routeros, script: r, ${extra} }`,
        /only a swos device has ports and vlans/,
      );
    }
  });

  test("a port number the switch can't have", () => {
    for (const number of ["0", "33", "99", "1.5", "x"]) {
      fails("      3: off", `      ${number}: off`, /numbered from 1 to 32/);
    }
  });

  test("but a switch has ports 1 to 32", () => {
    const m = changed("      17: {", "      32: {");
    assert.deepEqual(
      m.devices[2].ports.map((p) => p.index),
      [1, 2, 3, 4, 32],
    );
  });
});
