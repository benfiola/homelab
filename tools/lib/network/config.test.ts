import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { join } from "node:path";
import { parse } from "yaml";
import { listOutputs, renderNetwork } from "./config.ts";
import { files, remove, secrets, workspace } from "./fixture.ts";

const dirs: string[] = [];
after(() => remove(dirs));
const dir = () => workspace(files, dirs);

describe("listOutputs", () => {
  test("is a file for each device and each wireguard client, named for its profile", () => {
    assert.deepEqual(
      listOutputs(dir()).map((o) => [o.file, o.profile]),
      [
        ["router.rsc", "routeros"],
        ["ap.one.sh", "openwrt"],
        ["core.switch.yaml", "swos"],
        ["wireguard.laptop-home.conf", "wireguard"],
        ["wireguard.laptop-servers.conf", "wireguard"],
        ["wireguard.phone.conf", "wireguard"],
      ],
    );
  });
});

describe("renderNetwork", () => {
  test("renders only the files named, and rejects names it doesn't know", () => {
    assert.deepEqual(
      Object.keys(renderNetwork(dir(), secrets, ["core.switch.yaml"])),
      ["core.switch.yaml"],
    );
    assert.throws(
      () => renderNetwork(dir(), secrets, ["nope"]),
      /no output 'nope' \(have: router\.rsc, ap\.one\.sh/,
    );
  });

  test("a switch needs no secrets", () => {
    assert.match(
      renderNetwork(dir(), {}, ["core.switch.yaml"])["core.switch.yaml"],
      /identity: core\.switch/,
    );
  });

  test("a missing secret is an error that names the file and the secret", () => {
    assert.throws(
      () => renderNetwork(dir(), { ...secrets, router: {} }, ["router.rsc"]),
      /router\.rsc \(router\.rsc\): 'secrets\.router\.admin' is not defined/,
    );
    assert.throws(
      () => renderNetwork(dir(), {}, ["router.rsc"]),
      /'secrets\.wireguard\.interfaces\.home\.private' is not defined/,
    );
    assert.throws(
      () => renderNetwork(dir(), {}, ["wireguard.phone.conf"]),
      /wireguard\.phone\.conf: 'secrets\.wireguard\.devices\.phone\.home\.private' is not defined/,
    );
    assert.throws(
      () => renderNetwork(dir(), { router: { admin: "x" } }, ["ap.one.sh"]),
      /'secrets\.wifi\.home' is not defined/,
    );
  });

  test("a script with logic in it is refused", () => {
    const d = workspace(
      { ...files, "scripts/ap.sh": "{% if x %}y{% endif %}" },
      dirs,
    );
    assert.throws(
      () => renderNetwork(d, secrets, ["ap.one.sh"]),
      /not supported/,
    );
  });

  test("a script that names a block that doesn't exist is an error", () => {
    const d = workspace({ ...files, "scripts/ap.sh": "{{ ap.nope }}" }, dirs);
    assert.throws(
      () => renderNetwork(d, secrets, ["ap.one.sh"]),
      /'ap\.nope' is not defined/,
    );
  });
});

describe("wireguard clients", () => {
  const rendered = renderNetwork(dir(), secrets);

  test("a client on several interfaces has a file for each, named for both", () => {
    assert.match(
      rendered["wireguard.laptop-home.conf"],
      /PrivateKey = LH\nAddress = 10\.9\.0\.2\/32\n/,
    );
    assert.match(
      rendered["wireguard.laptop-servers.conf"],
      /PrivateKey = LS\nAddress = 10\.9\.1\.2\/32\n/,
    );
  });

  test("a client on one interface is named for the device alone", () => {
    assert.match(
      rendered["wireguard.phone.conf"],
      /PrivateKey = PH\nAddress = 10\.9\.0\.3\/32\n/,
    );
  });

  test("the server's key, port and routes are the interface's", () => {
    const home = rendered["wireguard.phone.conf"];
    assert.match(
      home,
      /PublicKey = HPUB\nEndpoint = wireguard\.example\.test:13001\n/,
    );
    assert.match(home, /AllowedIPs = 10\.0\.33\.2\/32, 10\.0\.88\.1\/32\n$/);
  });

  test("the router is the resolver of a client that can reach it", () => {
    assert.match(rendered["wireguard.phone.conf"], /\nDNS = 10\.0\.88\.1\n/);
    assert.doesNotMatch(rendered["wireguard.laptop-servers.conf"], /DNS/);
  });
});

describe("the router", () => {
  const router = renderNetwork(dir(), secrets, ["router.rsc"])["router.rsc"];
  const lines = router.split("\n");
  const has = (line: string) =>
    assert.ok(lines.includes(line), `missing: ${line}`);

  test("names the device and the domain, and takes its secrets", () => {
    has("identity=router domain=example.test");
    has("password=ROUTER");
  });

  test("lists vlans by id, and the wireguard ports as a range", () => {
    has("ids=8,24,32,88 lists=HOME,IOT,SERVERS,MANAGEMENT ports=13001-13002");
  });

  test("a vlan is an interface, a list, an address, a pool, a dhcp server and a dhcp network", () => {
    has("/interface/vlan/add name=iot interface=bridge vlan-id=24");
    has("/interface/list/add name=IOT");
    has("/interface/list/member/add list=IOT interface=iot");
    has("/ip/address/add address=10.0.24.1/24 interface=iot network=10.0.24.0");
    has("/ip/pool/add name=iot ranges=10.0.24.2-10.0.24.254");
    has(
      "/ip/dhcp-server/add name=iot address-pool=iot interface=iot lease-time=10m",
    );
    has(
      "/ip/dhcp-server/network/add comment=iot address=10.0.24.0/24 dns-server=10.0.88.1 gateway=10.0.24.1 netmask=24",
    );
  });

  test("a wider vlan keeps its pool in the first /24, and its prefix elsewhere", () => {
    has("/ip/pool/add name=servers ranges=10.0.32.2-10.0.32.254");
    has(
      "/ip/address/add address=10.0.32.1/23 interface=servers network=10.0.32.0",
    );
    has(
      "/ip/dhcp-server/network/add comment=servers address=10.0.32.0/23 dns-server=10.0.88.1 gateway=10.0.32.1 netmask=23",
    );
  });

  test("a vlan with wireguard has its interface in the list, and an address on it", () => {
    has("/interface/list/member/add list=HOME interface=wg-home");
    has(
      "/ip/address/add address=10.9.0.1/24 interface=wg-home network=10.9.0.0",
    );
    assert.ok(!lines.some((l) => l.includes("interface=wg-iot")));
  });

  test("a wireguard interface has its key, and a peer for each client address", () => {
    has(
      '/interface/wireguard/add name=wg-home listen-port=13001 mtu=1420 private-key="HP"',
    );
    has(
      '/interface/wireguard/peers/add allowed-address=10.9.0.2/32 interface=wg-home name=laptop-home public-key="LHPUB"',
    );
    has(
      '/interface/wireguard/peers/add allowed-address=10.9.1.2/32 interface=wg-servers name=laptop-servers public-key="LSPUB"',
    );
    has(
      '/interface/wireguard/peers/add allowed-address=10.9.0.3/32 interface=wg-home name=phone public-key="PHPUB"',
    );
  });

  test("a host is a lease, and a dns record only if it asks", () => {
    has(
      '/ip/dhcp-server/lease/add address=10.0.24.2 server=iot mac-address=AA:BB:CC:DD:EE:02 comment="tv"',
    );
    has("/ip/dns/static/add name=desk.example.test address=10.0.8.2 ttl=10m");
    assert.ok(!lines.some((l) => l.includes("name=tv.example.test")));
  });

  test("leases follow the order of the vlans", () => {
    const leases = lines.filter((l) =>
      l.startsWith("/ip/dhcp-server/lease/add"),
    );
    assert.deepEqual(
      leases.map((l) => l.match(/comment="(.*)"/)![1]),
      ["desk", "tv", "node.cluster"],
    );
  });

  test("a host that allows something is in the list of its vlan for it", () => {
    has(
      '/ip/firewall/address-list/add list=IOT_ALLOW_WAN address=10.0.24.2 comment="tv"',
    );
    has(
      '/ip/firewall/address-list/add list=IOT_ALLOW_INTRANET address=10.0.24.2 comment="tv"',
    );
    has(
      '/ip/firewall/address-list/add list=SERVERS_ALLOW_WAN address=10.0.32.2 comment="node.cluster"',
    );
  });

  test("a gateway is an ingress list", () => {
    has(
      '/ip/firewall/address-list/add list=INFRASTRUCTURE_INGRESS_HOME address=10.0.33.2/32 comment="cluster gateway (home)"',
    );
  });

  test("a host that asks is a bgp peer", () => {
    has(
      "/routing/bgp/connection/add instance=cluster name=node.cluster remote.address=10.0.32.2 local.role=ibgp templates=cluster",
    );
    assert.equal(
      lines.filter((l) => l.startsWith("/routing/bgp/connection/add")).length,
      1,
    );
  });
});

describe("an access point", () => {
  const ap = renderNetwork(dir(), secrets, ["ap.one.sh"])["ap.one.sh"];
  const lines = ap.split("\n");
  const has = (line: string) =>
    assert.ok(lines.includes(line), `missing: ${line}`);

  test("is named for the device", () => {
    has("hostname=ap.one");
  });

  test("bridges the vlans it carries, not the ones it doesn't", () => {
    has("set network.@device[-1].name='br-home'");
    has("set network.@device[-1].ports='br-trunk.24'");
    has("set network.@bridge-vlan[-1].vlan='88'");
    assert.ok(
      !lines.some((l) => l.includes("br-servers") || l.includes("vlan='32'")),
    );
  });

  test("a vlan with wifi is a network, and an ssid on each band", () => {
    has("set network.home=interface");
    has("set network.home.device='br-home'");
    has("set wireless.home2g.device='radio0'");
    has("set wireless.home5g.device='radio1'");
    has("set wireless.home5g.ssid='home-net'");
    assert.ok(!lines.some((l) => l.startsWith("set network.management")));
  });

  test("an sae network has the key of its vlan and no psk setting", () => {
    has("set wireless.home2g.encryption='sae-mixed'");
    has("set wireless.home2g.key='HOME'");
    has("set wireless.home2g.ocv='0'");
    assert.ok(!lines.includes("set wireless.home2g.ft_psk_generate_local='1'"));
    assert.ok(!lines.includes("set wireless.home2g.hidden='1'"));
  });

  test("a psk network has the psk settings, and may be hidden", () => {
    has("set wireless.iot2g.encryption='psk-mixed'");
    has("set wireless.iot2g.ft_psk_generate_local='1'");
    has("set wireless.iot2g.hidden='1'");
    assert.ok(!lines.includes("set wireless.iot2g.ocv='0'"));
  });
});

describe("a switch", () => {
  const config = renderNetwork(dir(), {}, ["core.switch.yaml"])[
    "core.switch.yaml"
  ];
  const parsed = (text: string) => import("yaml").then((y) => y.parse(text));

  test("is its device's ports, each configured alike but for its vlan", async () => {
    const { ports } = await parsed(config);
    assert.deepEqual(ports[0], {
      index: 1,
      name: "tv",
      enabled: true,
      autoNegotiation: true,
      flowControl: { tx: true, rx: false },
      vlan: {
        mode: "strict",
        receive: "untagged",
        defaultVlanId: 24,
        forceVlanId: false,
      },
    });
  });

  test("a disabled port is off, in the vlan the switch has for them", async () => {
    const { ports } = await parsed(config);
    assert.deepEqual(
      [ports[2].enabled, ports[2].name, ports[2].vlan.defaultVlanId],
      [false, "", 8],
    );
  });

  test("a trunk accepts tagged frames, and an sfp port says so", async () => {
    const { ports } = await parsed(config);
    assert.deepEqual(
      [
        ports[4].vlan.receive,
        ports[4].vlan.defaultVlanId,
        ports[4].sfpRateSelect,
      ],
      ["tagged", 1, true],
    );
    assert.equal(ports[0].sfpRateSelect, undefined);
  });

  test("a forced port says so", async () => {
    const { ports } = await parsed(config);
    assert.equal(ports[3].vlan.forceVlanId, true);
    assert.equal(ports[0].vlan.forceVlanId, false);
  });

  test("a vlan's members are its access ports, and every trunk", async () => {
    const { vlans } = await parsed(config);
    assert.deepEqual(
      vlans.map((v: any) => [v.id, v.name, v.members]),
      [
        [8, "home", [2, 17]],
        [24, "iot", [1, 17]],
        [88, "management", [4, 17]],
      ],
    );
  });

  test("only the vlans of the device are in the table", async () => {
    const { vlans } = await parsed(config);
    assert.equal(
      vlans.some((v: any) => v.name === "servers"),
      false,
    );
  });

  test("takes everything but what it injects from the template", () => {
    const edited = workspace(
      {
        ...files,
        "scripts/switch.yaml": files["scripts/switch.yaml"]
          .replace("    tx: true\n    rx: false", "    tx: false\n    rx: true")
          .replace("igmpSnooping: false", "igmpSnooping: true"),
      },
      dirs,
    );
    const { ports, vlans } = parse(
      renderNetwork(edited, {}, ["core.switch.yaml"])["core.switch.yaml"],
    );
    assert.ok(ports.every((p: any) => !p.flowControl.tx && p.flowControl.rx));
    assert.ok(vlans.every((v: any) => v.igmpSnooping));
  });

  test("a template that is not three parts is an error", () => {
    const d = workspace(
      { ...files, "scripts/switch.yaml": "system: {}\n" },
      dirs,
    );
    assert.throws(
      () => renderNetwork(d, {}, ["core.switch.yaml"]),
      /expected a switch, a port and a vlan/,
    );
  });

  test("a template that doesn't describe a configuration is an error", () => {
    const d = workspace(
      {
        ...files,
        "scripts/switch.yaml": files["scripts/switch.yaml"].replace(
          "    mode: strict",
          "    mode: loose",
        ),
      },
      dirs,
    );
    assert.throws(
      () => renderNetwork(d, {}, ["core.switch.yaml"]),
      /Invalid option: expected one of "disabled"\|"optional"\|"enabled"\|"strict"/,
    );
  });

  test("a name is quoted, whatever is in it", () => {
    const d = workspace(
      {
        ...files,
        "network.yaml": files["network.yaml"].replace(
          "name: tv, access",
          "name: 'a \"b\": c', access",
        ),
      },
      dirs,
    );
    const { ports } = parse(
      renderNetwork(d, {}, ["core.switch.yaml"])["core.switch.yaml"],
    );
    assert.equal(ports[0].name, 'a "b": c');
  });

  test("it is a configuration the switch tool accepts", async () => {
    const { validate } = await import("./profiles/swos/config.ts");
    const { parse } = await import("yaml");
    assert.doesNotThrow(() => validate(parse(config)));
  });
});

// the real configuration, with a made-up value for every secret: a script that names a secret
// that doesn't exist fails here, not when the configuration is next applied to a device
describe("network/", () => {
  const real = join(import.meta.dirname, "../../../network");
  const everything = (() => {
    // every secret the real configuration reaches for, found by rendering until nothing is missing
    const found: Record<string, any> = {};
    for (let i = 0; i < 400; i++) {
      try {
        return { secrets: found, rendered: renderNetwork(real, found) };
      } catch (e: any) {
        const m = /'secrets\.([\w.]+)' is not defined/.exec(e.message);
        if (!m) throw e;
        const keys = m[1].split(".");
        let node = found;
        keys.slice(0, -1).forEach((k) => (node = node[k] ??= {}));
        node[keys.at(-1)!] = `<${m[1]}>`;
      }
    }
    throw new Error("too many secrets");
  })();
  const rendered = everything.rendered;

  test("every output renders, completely", () => {
    assert.ok(Object.keys(rendered).length > 20);
    for (const [file, content] of Object.entries(rendered)) {
      assert.doesNotMatch(content, /\{\{|\{%/, file);
      assert.ok(content.length > 50, file);
    }
  });

  test("the secrets are where they should be", () => {
    assert.match(
      rendered["router.rsc"],
      /password="<router\.users\.externalDns>"/,
    );
  });

  test("wireguard peers are not kept alive", () => {
    for (const [file, content] of Object.entries(rendered)) {
      assert.doesNotMatch(content, /keepalive/i, file);
    }
  });

  test("the router resolves a device to the address it leases", () => {
    const address = (pattern: RegExp) =>
      rendered["router.rsc"].match(pattern)?.[1];
    assert.equal(
      address(
        /dns\/static\/add name=bedroom-2\.assistant\.fiola\.dev address=([\d.]+)/,
      ),
      address(/lease\/add address=([\d.]+) .*comment="bedroom-2\.assistant"/),
    );
  });

  test("every host on the network is a lease in its own vlan", () => {
    const router = rendered["router.rsc"];
    for (const [, address, server] of router.matchAll(
      /lease\/add address=([\d.]+) server=(\w+)/g,
    )) {
      const vlan = router.match(
        new RegExp(
          `dhcp-server/network/add comment=${server} address=([\\d.]+)/`,
        ),
      );
      assert.ok(
        vlan && address.startsWith(vlan[1].split(".").slice(0, 3).join(".")),
        `${address} in ${server}`,
      );
    }
  });
});
