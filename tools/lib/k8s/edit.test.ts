import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editor } from "./edit.ts";

const objects = (): Record<string, any>[] => [
  {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "web", namespace: "one" },
    spec: {
      template: {
        spec: { containers: [{ name: "a" }, { name: "b", image: "x" }] },
      },
    },
  },
  {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "web", namespace: "two" },
    spec: { template: { spec: { containers: [{ name: "a" }] } } },
  },
  {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: "job", namespace: "one" },
    spec: {
      jobTemplate: {
        spec: { template: { spec: { containers: [{ name: "c" }] } } },
      },
    },
  },
  {
    apiVersion: "extensions/v1beta1",
    kind: "Ingress",
    metadata: { name: "web", namespace: "one" },
  },
  { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "cm" } },
];

describe("find", () => {
  test("is the object of that kind and name, itself and not a copy", () => {
    const all = objects();
    assert.equal(editor(all).find({ kind: "ConfigMap", name: "cm" }), all[4]);
  });

  test("can select by namespace, or by api group", () => {
    const all = objects();
    const e = editor(all);
    assert.equal(
      e.find({ kind: "Deployment", name: "web", namespace: "two" }),
      all[1],
    );
    assert.equal(
      e.find({ kind: "Ingress", name: "web", group: "extensions" }),
      all[3],
    );
  });

  test("an object that isn't there is an error that says what was looked for", () => {
    const e = editor(objects());
    assert.throws(
      () => e.find({ kind: "Deployment", name: "renamed" }),
      /no object matches Deployment\/renamed/,
    );
    assert.throws(
      () =>
        e.find({ kind: "Ingress", name: "web", group: "networking.k8s.io" }),
      /no object matches networking\.k8s\.io\/Ingress\/web/,
    );
    assert.throws(
      () => e.find({ kind: "Deployment", name: "web", namespace: "three" }),
      /no object matches Deployment\/web in three/,
    );
  });

  test("more than one match is an error, not a guess", () => {
    assert.throws(
      () => editor(objects()).find({ kind: "Deployment", name: "web" }),
      /2 objects match Deployment\/web: select one, or use findAll/,
    );
  });
});

describe("findAll", () => {
  test("is every match", () => {
    const all = objects();
    assert.deepEqual(editor(all).findAll({ kind: "Deployment", name: "web" }), [
      all[0],
      all[1],
    ]);
  });

  test("and at least one", () => {
    assert.throws(
      () => editor(objects()).findAll({ kind: "Deployment", name: "nope" }),
      /no object matches Deployment\/nope/,
    );
  });
});

describe("container", () => {
  const e = editor(objects());
  const all = objects();

  test("is the container of that name, itself and not a copy", () => {
    const b = editor(all).container(all[0], "b");
    assert.equal(b.image, "x");
    assert.equal(b, all[0].spec.template.spec.containers[1]);
  });

  test("of a cron job's pod template too", () => {
    assert.equal(e.container(objects()[2], "c").name, "c");
  });

  test("a container that isn't there is an error that names the workload", () => {
    assert.throws(
      () => e.container(objects()[0], "nope"),
      /Deployment\/web has no container 'nope'/,
    );
  });

  test("something without a pod template is an error that says so", () => {
    assert.throws(
      () => e.container(objects()[4], "x"),
      /ConfigMap\/cm has no pod template/,
    );
  });
});

describe("item", () => {
  const e = editor(objects());

  test("is the item satisfying the predicate", () => {
    const list = [{ name: "a" }, { name: "b" }];
    assert.equal(
      e.item(list, (i) => i.name === "b", "thing b"),
      list[1],
    );
  });

  test("one that isn't there is an error that says what, and what there is", () => {
    assert.throws(
      () =>
        e.item(
          [{ name: "a" }, { name: "b" }],
          (i) => i.name === "c",
          "volume c",
        ),
      /no volume c \(have: a, b\)/,
    );
    assert.throws(
      () => e.item([1, 2], (i) => i === 3, "number 3"),
      /^Error: no number 3$/,
    );
  });
});

describe("replace", () => {
  const e = editor(objects());

  test("replaces the item in place", () => {
    const list = ["a", "b", "c"];
    e.replace(list, "b", "x");
    assert.deepEqual(list, ["a", "x", "c"]);
  });

  test("replaces the first of several", () => {
    const list = ["a", "a"];
    e.replace(list, "a", "x");
    assert.deepEqual(list, ["x", "a"]);
  });

  test("one that isn't there is an error, and changes nothing", () => {
    const list = ["a"];
    assert.throws(() => e.replace(list, "b", "x"), /expected 'b' in \["a"\]/);
    assert.deepEqual(list, ["a"]);
  });
});
