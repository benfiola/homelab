import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { container, replace } from "./edit.ts";

describe("container", () => {
  const workload = {
    kind: "Deployment",
    metadata: { name: "web" },
    spec: {
      template: {
        spec: { containers: [{ name: "a" }, { name: "b", image: "x" }] },
      },
    },
  };

  test("is the container of that name, itself and not a copy", () => {
    const b = container(workload, "b");
    assert.equal(b.image, "x");
    assert.equal(b, workload.spec.template.spec.containers[1]);
  });

  test("a container that isn't there is an error that names the workload", () => {
    assert.throws(
      () => container(workload, "nope"),
      /Deployment\/web has no container 'nope'/,
    );
  });
});

describe("replace", () => {
  test("replaces the entry in place", () => {
    const list = ["a", "b", "c"];
    replace(list, "b", "x");
    assert.deepEqual(list, ["a", "x", "c"]);
  });

  test("replaces the first entry when there are several, and the first of the list", () => {
    const list = ["a", "a"];
    replace(list, "a", "x");
    assert.deepEqual(list, ["x", "a"]);
  });

  test("an entry that isn't there is an error, so a changed upstream is noticed", () => {
    const list = ["a"];
    assert.throws(() => replace(list, "b", "x"), /expected 'b' in \["a"\]/);
    assert.deepEqual(list, ["a"]);
  });
});
