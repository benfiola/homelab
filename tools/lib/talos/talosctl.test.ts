import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Talos } from "./config.ts";
import { translateArguments } from "./talosctl.ts";

const hw = (image: string) => ({
  name: "",
  disks: {},
  image,
  imageConfig: { filename: "", schematic: {} },
});
const node = (name: string, profile: string) => ({
  name,
  hostname: `${name}.example.com`,
  profile,
  role: "worker" as const,
  interface: "eno1",
  enabled: true,
});
const talos: Talos = {
  cluster: { name: "c", endpoint: "example.com", kubernetes: "1.36.5" },
  nodes: [node("a", "x"), node("b", "x"), node("c", "y")],
  profiles: { x: hw("image-x"), y: hw("image-y") },
  documents: [],
};

describe("translateArguments", () => {
  test("leaves arguments it doesn't know alone", () => {
    assert.deepEqual(translateArguments(talos, ["get", "members"]), [
      "get",
      "members",
    ]);
  });

  test("a node flag with nothing after it is left for talosctl to refuse", () => {
    assert.deepEqual(translateArguments(talos, ["version", "-n"]), [
      "version",
      "-n",
    ]);
  });

  test("turns node names into hostnames, in every form of the flag", () => {
    assert.deepEqual(translateArguments(talos, ["version", "--nodes=a,b"]), [
      "version",
      "--nodes=a.example.com,b.example.com",
    ]);
    assert.deepEqual(translateArguments(talos, ["version", "--nodes", "a"]), [
      "version",
      "--nodes=a.example.com",
    ]);
    assert.deepEqual(translateArguments(talos, ["version", "-n", "a,other"]), [
      "version",
      "--nodes=a.example.com,other",
    ]);
  });

  test("upgrade gets the image of its nodes' profile", () => {
    assert.deepEqual(translateArguments(talos, ["upgrade", "--nodes=a,b"]), [
      "upgrade",
      "--nodes=a.example.com,b.example.com",
      "--image=image-x",
    ]);
  });

  test("upgrade takes nodes by hostname too", () => {
    assert.ok(
      translateArguments(talos, ["upgrade", "--nodes=c.example.com"]).includes(
        "--image=image-y",
      ),
    );
  });

  test("upgrade keeps an image it was given", () => {
    const args = translateArguments(talos, [
      "upgrade",
      "--nodes=a",
      "--image=mine",
    ]);
    assert.deepEqual(
      args.filter((a) => a.startsWith("--image")),
      ["--image=mine"],
    );
  });

  test("upgrade of nodes with different images is an error", () => {
    assert.throws(
      () => translateArguments(talos, ["upgrade", "--nodes=a,c"]),
      /single image/,
    );
  });

  test("upgrade of unknown nodes is an error", () => {
    assert.throws(
      () => translateArguments(talos, ["upgrade", "--nodes=nope"]),
      /single image/,
    );
    assert.throws(() => translateArguments(talos, ["upgrade"]), /single image/);
  });

  test("upgrade-k8s gets the cluster's kubernetes version", () => {
    assert.deepEqual(translateArguments(talos, ["upgrade-k8s"]), [
      "upgrade-k8s",
      "--to=1.36.5",
    ]);
    assert.deepEqual(
      translateArguments(talos, ["upgrade-k8s", "--to=1.37.0"]),
      ["upgrade-k8s", "--to=1.37.0"],
    );
  });
});
