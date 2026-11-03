import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Profile, Node, Talos } from "./config.ts";
import {
  machineConfig,
  merge,
  mergeDocuments,
  nodeDocuments,
} from "./machine.ts";

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

describe("merge", () => {
  test("merges mappings key by key, later over earlier", () => {
    assert.deepEqual(
      merge({ a: 1, b: { c: 1, d: 2 } }, { b: { c: 3 }, e: 4 }),
      { a: 1, b: { c: 3, d: 2 }, e: 4 },
    );
  });

  test("replaces anything that isn't a mapping or a list", () => {
    assert.equal(merge("a", "b"), "b");
    assert.deepEqual(merge({ a: 1 }, "b"), "b");
    assert.deepEqual(merge([1], { a: 1 }), { a: 1 });
  });

  test("ignores values that are missing", () => {
    assert.deepEqual(merge({ a: 1 }, undefined, { b: 2 }), { a: 1, b: 2 });
    assert.deepEqual(merge({ a: { b: 1 } }, { a: undefined }), { a: { b: 1 } });
  });

  test("is nothing when there is nothing to merge", () => {
    assert.equal(merge(), undefined);
    assert.equal(merge(undefined, undefined), undefined);
  });

  test("merges list entries that share a name, and appends the rest", () => {
    const merged = merge(
      { modules: [{ name: "a", parameters: ["x"] }, { name: "b" }] },
      { modules: [{ name: "a", parameters: ["y"] }, { name: "c" }] },
    );
    assert.deepEqual(merged.modules, [
      { name: "a", parameters: ["x", "y"] },
      { name: "b" },
      { name: "c" },
    ]);
  });

  test("lists of values gain the values they lack, once", () => {
    assert.deepEqual(
      merge({ options: ["rbind", "rw"] }, { options: ["rw", "rshared"] })
        .options,
      ["rbind", "rw", "rshared"],
    );
  });

  test("entries without a name are not the same entry", () => {
    const merged = merge(
      { mounts: [{ source: "/a" }] },
      { mounts: [{ source: "/b" }] },
    );
    assert.deepEqual(merged.mounts, [{ source: "/a" }, { source: "/b" }]);
  });

  test("does not change what it merges", () => {
    const a = { list: [{ name: "x", v: 1 }] };
    merge(a, { list: [{ name: "x", v: 2 }] });
    assert.deepEqual(a, { list: [{ name: "x", v: 1 }] });
  });
});

describe("mergeDocuments", () => {
  const dhcp = (extra = {}) => ({
    apiVersion: "v1alpha1",
    kind: "DHCPv4Config",
    name: "eno1",
    ...extra,
  });

  test("merges documents with the same apiVersion, kind and name", () => {
    const merged = mergeDocuments([dhcp({ a: 1 })], [dhcp({ b: 2 })]);
    assert.deepEqual(merged, [dhcp({ a: 1, b: 2 })]);
  });

  test("appends documents that differ in any of the three", () => {
    const merged = mergeDocuments(
      [dhcp()],
      [dhcp({ name: "eno2" })],
      [{ ...dhcp(), kind: "Other" }],
    );
    assert.equal(merged.length, 3);
  });

  test("documents of the legacy format, which have none, are one document", () => {
    const generated = { version: "v1alpha1", machine: { type: "worker" } };
    const merged = mergeDocuments(
      [generated, dhcp()],
      [{ machine: { kubelet: {} }, cluster: { a: 1 } }],
    );
    assert.deepEqual(merged, [
      {
        version: "v1alpha1",
        machine: { type: "worker", kubelet: {} },
        cluster: { a: 1 },
      },
      dhcp(),
    ]);
  });

  test("keeps the order of the first list, then appends", () => {
    const merged = mergeDocuments(
      [dhcp({ name: "a" }), dhcp({ name: "b" })],
      [dhcp({ name: "c" }), dhcp({ name: "a", x: 1 })],
    );
    assert.deepEqual(
      merged.map((d) => d.name),
      ["a", "b", "c"],
    );
  });
});
