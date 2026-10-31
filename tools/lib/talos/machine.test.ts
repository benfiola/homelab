import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Profile, Node, Talos } from "./config.ts";
import { machineConfig, nodeDocuments } from "./machine.ts";

const profile: Profile = {
  name: "hw",
  disks: {
    SYSTEM: { device: "/dev/sda" },
    EPHEMERAL: { device: "/dev/nvme0n1", size: "200GiB" },
    data: { device: "/dev/nvme0n1", size: "1600GiB" },
  },
  image: "installer:v1",
  imageConfig: { filename: "metal.iso", schematic: {} },
  machineConfig: { machine: { kernel: { modules: [{ name: "extra" }] } } },
};
const node: Node = {
  name: "a",
  hostname: "a.example.com",
  profile: "hw",
  role: "worker",
  interface: "eno1",
  enabled: true,
};
const talos: Talos = {
  cluster: { name: "c", endpoint: "example.com", kubernetes: "1.36.5" },
  nodes: [node],
  profiles: { hw: profile },
  documents: [{ machine: { kernel: { modules: [{ name: "base" }] } } }],
};

describe("nodeDocuments", () => {
  test("asks for dhcp on the node's interface, and names the node", () => {
    const docs = nodeDocuments(node, profile);
    assert.deepEqual(docs[0], {
      apiVersion: "v1alpha1",
      kind: "DHCPv4Config",
      name: "eno1",
    });
    assert.deepEqual(docs[1], {
      apiVersion: "v1alpha1",
      kind: "HostnameConfig",
      auto: "off",
      hostname: "a.example.com",
    });
  });

  test("configures talos' own volumes, and provisions the other disks raw", () => {
    const [, , ephemeral, data] = nodeDocuments(node, profile);
    assert.equal(ephemeral.kind, "VolumeConfig");
    assert.equal(ephemeral.name, "EPHEMERAL");
    assert.equal(data.kind, "RawVolumeConfig");
    assert.equal(data.name, "data");
  });

  test("a volume is the whole size on its disk, and grows into it", () => {
    const [, , ephemeral] = nodeDocuments(node, profile);
    assert.deepEqual(ephemeral.provisioning, {
      diskSelector: { match: "disk.dev_path == '/dev/nvme0n1'" },
      minSize: "200GiB",
      maxSize: "200GiB",
      grow: true,
    });
  });

  test("the disk talos installs to gets no volume", () => {
    assert.ok(!nodeDocuments(node, profile).some((d) => d.name === "SYSTEM"));
  });
});

describe("machineConfig", () => {
  const generated = [
    {
      version: "v1alpha1",
      machine: { type: "worker", kernel: { modules: [{ name: "gen" }] } },
    },
    { apiVersion: "v1alpha1", kind: "HostnameConfig", auto: "stable" },
  ];

  test("merges what is generated, the configuration of every node, the profile's, then the node's", () => {
    const docs = machineConfig(talos, node, generated);
    assert.deepEqual(
      docs[0].machine.kernel.modules.map((m: any) => m.name),
      ["gen", "base", "extra"],
    );
    assert.equal(docs[0].machine.type, "worker");
  });

  test("what is derived from the node wins over what is generated", () => {
    const docs = machineConfig(talos, node, generated);
    const hostname = docs.find((d) => d.kind === "HostnameConfig")!;
    assert.deepEqual(hostname, {
      apiVersion: "v1alpha1",
      kind: "HostnameConfig",
      auto: "off",
      hostname: "a.example.com",
    });
  });

  test("does not change its inputs", () => {
    const before = JSON.stringify([generated, talos]);
    machineConfig(talos, node, generated);
    assert.equal(JSON.stringify([generated, talos]), before);
  });
});
