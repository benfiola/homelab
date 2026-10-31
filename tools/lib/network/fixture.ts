import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// a small network that has one of everything, for tests to render
export const files: Record<string, string> = {
  "network.yaml": `
domain: example.test
resolver: 10.0.88.1
vlans:
  home: { id: 8, subnet: 10.0.8.0/24, wifi: { ssid: home-net, security: sae } }
  iot: { id: 24, subnet: 10.0.24.0/24, wifi: { ssid: iot-net, security: psk, hidden: true } }
  servers: { id: 32, subnet: 10.0.32.0/23, ap: false }
  management: { id: 88, subnet: 10.0.88.0/24 }
gateways:
  home: 10.0.33.2
wireguard:
  home: { port: 13001, subnet: 10.9.0.0/24, routes: [gateway:home, 10.0.88.1/32] }
  servers: { port: 13002, subnet: 10.9.1.0/24, routes: [10.0.32.0/23] }
clients:
  laptop: { home: 2, servers: 2 }
  phone: { home: 3 }
hosts:
  - { vlan: home, ip: 2, name: desk, mac: AA:BB:CC:DD:EE:01, dns: true }
  - { vlan: iot, ip: 2, name: tv, mac: AA:BB:CC:DD:EE:02, allow: [wan, intranet] }
  - { vlan: servers, ip: 2, name: node.cluster, mac: AA:BB:CC:DD:EE:03, dns: true, allow: [wan], bgp: true }
devices:
  router: { profile: routeros, script: router.rsc }
  ap.one: { profile: openwrt, script: ap.sh }
  core.switch:
    profile: swos
    script: switch.yaml
    vlans: [home, iot, management]
    unused: home
    ports:
      1: { name: tv, access: iot }
      2: { name: desk, access: home }
      3: off
      4: { name: rescue, access: management, force: true }
      17: { name: up, trunk: true, sfp: true }
`,
  "scripts/router.rsc": `identity={{ device.name }} domain={{ domain }}
password={{ secrets.router.admin }}
ids={{ router.vlanIds }} lists={{ router.vlanLists }} ports={{ router.wireguardPorts }}
{{ router.vlanInterfaces }}
{{ router.wireguardInterfaces }}
{{ router.wireguardPeers }}
{{ router.interfaceLists }}
{{ router.addresses }}
{{ router.pools }}
{{ router.dhcpServers }}
{{ router.dhcpNetworks }}
{{ router.leases }}
{{ router.dns }}
{{ router.bgpConnections }}
{{ router.allowLists }}
{{ router.ingressLists }}
`,
  "scripts/switch.yaml": `# a SwOS switch, in three parts separated by \`---\`: the switch, a port and a vlan. the second and
# third are filled in once for each port and vlan the switch has, where the first has them.
system:
  identity: "{{ device.name }}"
ports:
{{ switch.ports }}
vlans:
{{ switch.vlans }}
---
- index: {{ port.index }}
  name: "{{ port.name }}"
  enabled: {{ port.enabled }}
  autoNegotiation: true
  flowControl:
    tx: true
    rx: false
  {{ port.sfp }}
  vlan:
    mode: strict
    receive: {{ port.receive }}
    defaultVlanId: {{ port.vlan }}
    forceVlanId: {{ port.force }}
---
- id: {{ vlan.id }}
  name: "{{ vlan.name }}"
  members: {{ vlan.members }}
  portIsolation: true
  learning: true
  mirror: false
  igmpSnooping: false
`,
  "scripts/ap.sh": `hostname={{ device.name }}
{{ ap.bridgeDevices }}
{{ ap.bridgeVlans }}
{{ ap.interfaces }}
{{ ap.wireless }}
`,
};

export const secrets = {
  router: { admin: "ROUTER" },
  wifi: { home: "HOME", iot: "IOT" },
  wireguard: {
    interfaces: {
      home: { private: "HP", public: "HPUB" },
      servers: { private: "SP", public: "SPUB" },
    },
    devices: {
      laptop: {
        home: { private: "LH", public: "LHPUB" },
        servers: { private: "LS", public: "LSPUB" },
      },
      phone: { home: { private: "PH", public: "PHPUB" } },
    },
  },
};

// writes files (by path within the directory) to a new directory, and returns it
export const workspace = (
  contents: Record<string, string> = files,
  cleanup: string[] = [],
): string => {
  const dir = mkdtempSync(join(tmpdir(), "network-"));
  cleanup.push(dir);
  for (const [name, content] of Object.entries(contents)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

export const remove = (dirs: string[]) =>
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
