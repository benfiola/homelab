import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { loadTalos } from "./config.ts";

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const files = {
  "cluster.yaml": "name: c\nendpoint: c.example.com\nkubernetes: 1.36.5\n",
  "nodes.yaml":
    "nodes:\n  - { name: a, profile: hw, role: controlplane, interface: eno1 }\n  - { name: b, profile: hw, role: worker, interface: eno2, enabled: false }\n",
  "profiles/hw.yaml":
    "disks:\n  SYSTEM: { device: /dev/sda }\nimage: example/installer:v1\nimageConfig:\n  filename: metal.iso\n  schematic: {}\n",
  "config/one.yaml":
    "machine: { a: 1 }\n---\napiVersion: v1alpha1\nkind: Extra\nname: x\n",
  "config/two.yaml": "cluster: { b: 2 }\n",
};

const workspace = (overrides: Record<string, string | null> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "talos-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) continue;
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

describe("loadTalos", () => {
  test("reads the cluster, nodes, profiles and configuration documents", () => {
    const talos = loadTalos(workspace());
    assert.deepEqual(talos.cluster, {
      name: "c",
      endpoint: "c.example.com",
      kubernetes: "1.36.5",
    });
    assert.equal(talos.nodes.length, 2);
    assert.equal(talos.profiles.hw.disks.SYSTEM.device, "/dev/sda");
    assert.equal(talos.profiles.hw.image, "example/installer:v1");
    assert.equal(talos.documents.length, 3);
  });

  test("a node's hostname is its name under the cluster endpoint, and it is enabled unless said otherwise", () => {
    const [a, b] = loadTalos(workspace()).nodes;
    assert.equal(a.hostname, "a.c.example.com");
    assert.equal(a.enabled, true);
    assert.equal(b.enabled, false);
  });

  test("a profile is named for its file", () => {
    assert.deepEqual(Object.keys(loadTalos(workspace()).profiles), ["hw"]);
  });

  test("a node with an unknown profile is an error that lists the known ones", () => {
    const dir = workspace({
      "nodes.yaml":
        "nodes:\n  - { name: a, profile: nope, role: worker, interface: eno1 }\n",
    });
    assert.throws(() => loadTalos(dir), /no profile 'nope' \(have: hw\)/);
  });

  test("a node needs a role of controlplane or worker", () => {
    const dir = workspace({
      "nodes.yaml":
        "nodes:\n  - { name: a, profile: hw, role: master, interface: eno1 }\n",
    });
    assert.throws(
      () => loadTalos(dir),
      /role: Invalid option: expected one of "controlplane"\|"worker"/,
    );
  });

  test("node names are unique", () => {
    const dir = workspace({
      "nodes.yaml":
        "nodes:\n  - { name: a, profile: hw, role: worker, interface: e }\n  - { name: a, profile: hw, role: worker, interface: e }\n",
    });
    assert.throws(() => loadTalos(dir), /unique/);
  });

  test("a profile needs a system disk", () => {
    const dir = workspace({
      "profiles/hw.yaml": "disks: {}\nimage: x\nimageConfig: { filename: f }\n",
    });
    assert.throws(() => loadTalos(dir), /disks\.SYSTEM\.device/);
  });

  test("a kubernetes version written as a number is still a version", () => {
    const dir = workspace({
      "cluster.yaml": "name: c\nendpoint: e\nkubernetes: 1.36\n",
    });
    assert.equal(loadTalos(dir).cluster.kubernetes, "1.36");
  });
});

// the versions in talos/ are the cluster's, and pins.json holds the tools that run against it
describe("talos/", () => {
  const root = join(import.meta.dirname, "../../..");
  const talos = loadTalos(join(root, "talos"));
  const pins = JSON.parse(readFileSync(join(root, "pins.json"), "utf-8"));

  test("the kubernetes version is the one kubectl is pinned to", () => {
    assert.equal(talos.cluster.kubernetes, pins.kubectl.version);
  });

  test("every profile image is the installer of the talos version talosctl is pinned to", () => {
    for (const profile of Object.values(talos.profiles)) {
      assert.ok(
        profile.image.endsWith(`:v${pins.talosctl.version}`),
        `${profile.name}: ${profile.image}`,
      );
    }
  });
});
