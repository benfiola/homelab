import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { App, type Namespace } from "./app.ts";
import { bucketSyncKeys, secretRef } from "./k8s/secrets.ts";
import { hasCommand, serve } from "./testing.ts";

const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  template:
    spec:
      containers:
        - name: web
          image: web:1
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: web
subjects:
  - kind: ServiceAccount
    name: web
    namespace: default
`;

const server = await serve({
  "deployment.yaml": deployment,
  "sa.yaml":
    "apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: a\n  namespace: default\n",
});
after(() => server.close());

const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// most tests only care about what they added, not the Namespace object a handle to add it
// through brings with it
const withoutNamespace = (objects: any[]) =>
  objects.filter((o) => o.kind !== "Namespace");

const kinds = async (h: App) =>
  withoutNamespace(await h.objects()).map(
    (o) => `${o.kind}/${o.metadata.name}`,
  );

describe("App", () => {
  test("collects everything created through it, in creation order", async () => {
    const h = new App("web", "/apps/web");
    const ns = h.namespace();
    ns.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "one" } });
    const workload = ns
      .deployment("web")
      .addContainer("web", { image: "image:1" });
    workload.service({ http: 80 });
    ns.vpa(workload);
    assert.deepEqual(await kinds(h), [
      "ConfigMap/one",
      "Deployment/web",
      "Service/web",
      "VerticalPodAutoscaler/web",
    ]);
  });

  test("builds a workload when the app finishes, so later containers are included", async () => {
    const h = new App("web", "/apps/web");
    const workload = h.namespace().statefulSet("web");
    workload.addContainer("first", { image: "image:1" });
    workload.addContainer("second", { image: "image:2" });
    const [object] = withoutNamespace(await h.objects());
    assert.deepEqual(
      object.spec.template.spec.containers.map((c: any) => c.name),
      ["first", "second"],
    );
  });

  test("builds a route when the app finishes, so later matches are included", async () => {
    const h = new App("web", "/apps/web");
    const ns = h.namespace();
    const service = ns.deployment("web").service({ http: 80 });
    const route = ns.httpRoute("family", "web.fiola.dev");
    route.match(service, 80, { path: "/a" });
    route.match(service, 80, { path: "/b" });
    const http = (await h.objects()).find((o) => o.kind === "HTTPRoute")!;
    assert.deepEqual(
      http.spec.rules.map((r: any) => r.matches[0].path.value),
      ["/a", "/b"],
    );
    assert.ok((await kinds(h)).includes("ListenerSet/web.fiola.dev"));
  });

  test("registers tcp routes and the vpa of a workload or a plain target", async () => {
    const h = new App("web", "/apps/web");
    const ns = h.namespace();
    const workload = ns.deployment("web");
    ns.tcpRoute(
      "family",
      "web.fiola.dev",
      9000,
      { kind: "Service", name: "web" },
      9000,
    );
    ns.vpa(workload);
    ns.vpa(
      { kind: "Rollout", name: "x", apiVersion: "argoproj.io/v1alpha1" },
      { advisory: true },
    );
    const objects = await h.objects();
    assert.ok(objects.some((o) => o.kind === "TCPRoute"));
    const vpas = objects.filter((o) => o.kind === "VerticalPodAutoscaler");
    assert.equal(vpas[0].spec.targetRef.apiVersion, "apps/v1");
    assert.equal(vpas[1].spec.targetRef.apiVersion, "argoproj.io/v1alpha1");
    assert.equal(vpas[1].spec.updatePolicy.updateMode, "Off");
  });

  describe("secrets", () => {
    const via = async (app: string, use: (h: App) => void) => {
      const h = new App(app, `/apps/${app}`);
      use(h);
      return h;
    };

    test("an app names its Secret and lists its keys, and is given a store and a push in external-secrets-operator", async () => {
      const h = await via("web", (h) =>
        h.namespace().secrets("credentials", ["token"]),
      );
      const objects = withoutNamespace(await h.objects());
      assert.deepEqual(
        objects.map((o) => `${o.kind}/${o.metadata.name}`),
        ["SecretStore/web", "PushSecret/web-credentials"],
      );
      for (const object of objects) {
        assert.equal(object.metadata.namespace, "external-secrets-operator");
      }
      assert.deepEqual(Object.keys(objects[1].spec.template.data), ["token"]);
    });

    test("the keys are read through the Secret it returns", async () => {
      let credentials: ReturnType<Namespace["secrets"]> | undefined;
      await via("web", (h) => {
        credentials = h.namespace().secrets("credentials", ["token"]);
      });
      assert.deepEqual((credentials as any).key("token"), {
        secretKeyRef: { name: "credentials", key: "token" },
      });
    });

    test("an app that names its namespace is pushed to that namespace", async () => {
      const h = await via("web", (h) => {
        h.namespace({ name: "elsewhere" }).secrets("credentials", ["token"]);
      });
      const [store, push] = withoutNamespace(await h.objects());
      assert.equal(store.spec.provider.kubernetes.remoteNamespace, "elsewhere");
      assert.equal(push.metadata.name, "elsewhere-credentials");
    });

    test("the store is added once, however many Secrets are pushed", async () => {
      const h = await via("mail", (h) => {
        const ns = h.namespace();
        ns.secrets("one", ["a"]);
        ns.templatedSecrets("two", { B: h.secretRef("b") });
      });
      assert.deepEqual(await kinds(h), [
        "SecretStore/mail",
        "PushSecret/mail-one",
        "PushSecret/mail-two",
      ]);
    });

    test("a Secret can be put in another namespace, which gets a store of its own", async () => {
      const h = await via("cilium", (h) => {
        h.namespace().secrets("credentials", ["a"]);
        const secrets = h.namespace({ name: "cilium-secrets" });
        secrets.secrets("elsewhere-credentials", ["a"]);
        secrets.templatedSecrets("rendered", { B: h.secretRef("b") });
      });
      const objects = withoutNamespace(await h.objects());
      assert.deepEqual(
        objects.map((o) => `${o.kind}/${o.metadata.name}`),
        [
          "SecretStore/cilium",
          "PushSecret/cilium-credentials",
          "SecretStore/cilium-secrets",
          "PushSecret/cilium-secrets-elsewhere-credentials",
          "PushSecret/cilium-secrets-rendered",
        ],
      );
      assert.equal(
        objects[2].spec.provider.kubernetes.remoteNamespace,
        "cilium-secrets",
      );
    });

    test("a section other than the app's own can be read", async () => {
      const h = await via("web", (h) => {
        h.namespace().secrets("shared", ["token"], { from: "shared-app" });
      });
      const push = withoutNamespace(await h.objects())[1];
      assert.equal(
        push.spec.template.data.token,
        secretRef("token", "shared-app"),
      );
    });

    test("the same Secret can't be pushed twice", async () => {
      await assert.rejects(
        async () =>
          via("mail", (h) => {
            const ns = h.namespace();
            ns.secrets("one", ["a"]);
            ns.templatedSecrets("one", { B: h.secretRef("b") });
          }),
        /pushes the Secret behind mail-one twice/,
      );
    });

    test("secretRef reads the app's own section", async () => {
      assert.equal(
        new App("web", "/apps/web").secretRef("token"),
        secretRef("token", "web"),
      );
    });

    test("assets are synced with bucket-sync's credentials, pushed from its own section", async () => {
      const h = await via("llama-cpp", (h) => h.namespace().assetsServer());
      const objects = withoutNamespace(await h.objects());
      const push = objects.find((o) => o.kind === "PushSecret")!;
      assert.equal(
        push.metadata.name,
        "llama-cpp-bucket-sync-llama-cpp-assets",
      );
      assert.deepEqual(Object.keys(push.spec.template.data), bucketSyncKeys);
      assert.match(
        push.spec.template.data["encryption-key"],
        /"bucket-sync"\) "encryption-key"/,
      );
      const policy = objects.find((o) => o.kind === "BucketSyncPolicy");
      assert.ok(
        JSON.stringify(policy).includes("bucket-sync-llama-cpp-assets"),
      );
    });

    test("the assets server is found in the app's namespace, wherever that is", async () => {
      const named = async (namespaceName?: string) => {
        const h = new App("llama-cpp", "/apps/llama-cpp");
        return h.namespace({ name: namespaceName }).assetsServer().url;
      };
      assert.equal(await named(), "http://assets-server.llama-cpp.svc:8080");
      assert.equal(
        await named("elsewhere"),
        "http://assets-server.elsewhere.svc:8080",
      );
    });
  });

  test("configMap registers the object and returns it; files reads from the app's directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.conf"), "hello\n");
    const h = new App("web", dir);
    const config = h.namespace().configMap("web-config", h.files("a.conf"));
    assert.equal(config.metadata.name, "web-config");
    assert.deepEqual(config.data, { "a.conf": "hello\n" });
    assert.deepEqual(await kinds(h), ["ConfigMap/web-config"]);
  });

  test("nasVolume adds a volume and its claim", async () => {
    const h = new App("web", "/apps/web");
    h.namespace().nasVolume("media");
    assert.deepEqual(await kinds(h), [
      "PersistentVolume/media",
      "PersistentVolumeClaim/media",
    ]);
  });

  test("volumeBackup adds the backup and the Secret it reads, pushed into the app's namespace", async () => {
    const h = new App("web", "/apps/web");
    h.namespace().volumeBackup("config", { schedule: "0 3 * * *" });
    assert.deepEqual(await kinds(h), [
      "SecretStore/web",
      "PushSecret/web-volsync-mover-config",
      "ReplicationSource/config",
    ]);
    const [, push, source] = withoutNamespace(await h.objects());
    assert.equal(
      push.spec.template.data.RESTIC_REPOSITORY.includes("/web/config"),
      true,
    );
    assert.equal(source.spec.trigger.schedule, "0 3 * * *");
  });

  test("volumeBackup of a PVC in another namespace uses that namespace for the repository too", async () => {
    const h = new App("web", "/apps/web");
    h.namespace({ name: "other" }).volumeBackup("config");
    const [store, push, source] = withoutNamespace(await h.objects());
    assert.equal(store.metadata.name, "other");
    assert.equal(push.metadata.name, "other-volsync-mover-config");
    assert.equal(source.metadata.namespace, "other");
    assert.ok(
      push.spec.template.data.RESTIC_REPOSITORY.endsWith("/other/config"),
    );
  });
});

describe("App.namespace", () => {
  test("creates the app's namespace, privileged on request", async () => {
    const h = new App("web", "/apps/web");
    h.namespace();
    const [plain] = await h.objects();
    assert.deepEqual(plain.metadata, { name: "web", namespace: "web" });

    const h2 = new App("web", "/apps/web");
    h2.namespace({ privileged: true });
    const [privileged] = await h2.objects();
    assert.equal(
      privileged.metadata.labels["pod-security.kubernetes.io/enforce"],
      "privileged",
    );
  });

  test("the handle it returns creates everything in that namespace", async () => {
    const h = new App("web", "/apps/web");
    const ns = h.namespace({ name: "other" });
    assert.equal(ns.name, "other");
  });

  test("external skips declaring the namespace, for one another app owns", async () => {
    const h = new App("web", "/apps/web");
    const ns = h.namespace({ name: "other", external: true });
    ns.configMap("cfg", {});
    const objects = await h.objects();
    assert.equal(objects.some((o) => o.kind === "Namespace"), false);
    assert.equal(objects[0].metadata.namespace, "other");
  });
});

describe("App.manifest and App.postRender", () => {
  const write = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  };

  test("adds the objects of a manifest in the app's directory", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    const ns = h.namespace();
    await ns.manifest("manifest.yaml");
    ns.add({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "after" },
    });
    assert.deepEqual(await kinds(h), [
      "Deployment/web",
      "ServiceAccount/web",
      "ClusterRoleBinding/web",
      "ConfigMap/after",
    ]);
  });

  const kustomizeOptions = {
    skip: !hasCommand("kustomize") && "kustomize is not installed",
  };

  test(
    "a kustomization can be moved into a namespace, with what refers to it",
    kustomizeOptions,
    async () => {
      const h = new App("web", "/apps/web");
      await h
        .namespace({ name: "moved" })
        .kustomize(server.url("deployment.yaml"));
      const objects = await h.objects();
      const find = (kind: string) => objects.find((o) => o.kind === kind)!;
      assert.equal(find("Deployment").metadata.namespace, "moved");
      assert.equal(find("ClusterRoleBinding").subjects[0].namespace, "moved");
    },
  );

  test(
    "a kustomization can add labels, selectors included",
    kustomizeOptions,
    async () => {
      const h = new App("web", "/apps/web");
      await h.namespace().kustomize(server.url("deployment.yaml"), {
        labels: { "app.kubernetes.io/name": "web" },
      });
      const d = (await h.objects()).find((o) => o.kind === "Deployment")!;
      assert.equal(d.metadata.labels["app.kubernetes.io/name"], "web");
      assert.equal(
        d.spec.selector.matchLabels["app.kubernetes.io/name"],
        "web",
      );
      assert.equal(
        d.spec.template.metadata.labels["app.kubernetes.io/name"],
        "web",
      );
    },
  );

  test("a missing manifest fails as soon as it is awaited", async () => {
    const h = new App("web", write({}));
    await assert.rejects(
      () => h.namespace().manifest("missing.yaml"),
      /missing\.yaml/,
    );
  });

  test("post-render hooks change the objects they find, whatever added them", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.postRender((e) => {
      e.find({
        kind: "Deployment",
        name: "web",
      }).spec.template.spec.containers[0].image = "web:2";
    });
    await h.namespace().manifest("manifest.yaml");
    const [d] = withoutNamespace(await h.objects());
    assert.equal(d.spec.template.spec.containers[0].image, "web:2");
  });

  test("hooks run once everything is built and has its namespace, in the order they were added", async () => {
    const h = new App("web", write({}));
    const seen: string[] = [];
    h.postRender((e) => {
      seen.push("first");
      e.find({ kind: "ConfigMap", name: "c", namespace: "web" }).data.first =
        "1";
    });
    h.postRender((e) => {
      seen.push("second");
      // sees the first hook's change, and objects made after the hook was added
      const c = e.find({ kind: "ConfigMap", name: "c" });
      c.data.second =
        c.data.first + e.find({ kind: "ConfigMap", name: "d" }).metadata.name;
    });
    const ns = h.namespace();
    ns.configMap("c", {});
    ns.configMap("d", {});
    const objects = withoutNamespace(await h.objects());
    assert.deepEqual(seen, ["first", "second"]);
    assert.deepEqual(objects[0].data, { first: "1", second: "1d" });
  });

  test("one hook can change several objects", async () => {
    const h = new App("web", write({}));
    const ns = h.namespace();
    ns.configMap("a", {});
    ns.configMap("b", {});
    h.postRender((e) => {
      for (const c of [
        e.find({ kind: "ConfigMap", name: "a" }),
        e.find({ kind: "ConfigMap", name: "b" }),
      ]) {
        c.data = { changed: "yes" };
      }
    });
    assert.deepEqual(
      withoutNamespace(await h.objects()).map((o) => o.data),
      [{ changed: "yes" }, { changed: "yes" }],
    );
  });

  test("hooks don't accumulate when the objects are read twice, whether a source or an add made them", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    const ns = h.namespace();
    await ns.manifest("manifest.yaml");
    ns.add({
      kind: "Thing",
      apiVersion: "v1",
      metadata: { name: "t" },
      spec: { args: ["--old"] },
    });
    h.postRender((e) => {
      e.find({
        kind: "Deployment",
        name: "web",
      }).spec.template.spec.containers.push({ name: "extra" });
      const thing = e.find({ kind: "Thing", name: "t" });
      e.replace(thing.spec.args, "--old", "--new");
    });
    await h.objects();
    const objects = await h.objects();
    const d = objects.find((o) => o.kind === "Deployment")!;
    const thing = objects.find((o) => o.kind === "Thing")!;
    assert.equal(d.spec.template.spec.containers.length, 2);
    assert.deepEqual(thing.spec.args, ["--new"]);
  });

  test("the objects that were added are not changed by hooks", async () => {
    const h = new App("web", write({}));
    const added = {
      kind: "Thing",
      apiVersion: "v1",
      metadata: { name: "t" },
      spec: { n: 1 },
    };
    h.namespace().add(added);
    h.postRender((e) => {
      e.find({ kind: "Thing", name: "t" }).spec.n = 2;
    });
    const [thing] = withoutNamespace(await h.objects());
    assert.equal(thing.spec.n, 2);
    assert.equal(added.spec.n, 1);
  });

  test("a hook that finds nothing is an error naming the app, so a changed upstream is noticed", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    await h.namespace().manifest("manifest.yaml");
    h.postRender((e) => {
      e.find({ kind: "Deployment", name: "renamed" });
    });
    assert.throws(
      () => h.objects(),
      /^Error: web: no object matches Deployment\/renamed$/,
    );
  });

  test("a hook can select by api group", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    await h.namespace().manifest("manifest.yaml");
    h.postRender((e) => {
      e.find({ kind: "Deployment", name: "web", group: "extensions" });
    });
    assert.throws(
      () => h.objects(),
      /web: no object matches extensions\/Deployment\/web/,
    );
  });
});

describe("Source.find", () => {
  const write = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  };

  // a deployment with its own selector (unlike one `h.deployment` would build) and no volumes,
  // so wrapping it can be checked against what it actually has rather than Workload's conventions
  const demo = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      containers:
        - name: demo
          image: demo:1
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo-config
data:
  a: b
`;

  test("a Deployment, StatefulSet or DaemonSet is found as a Workload", async () => {
    const h = new App("web", write({ "manifest.yaml": demo }));
    const source = await h.namespace().manifest("manifest.yaml");
    const workload = source.find("Deployment", "demo");
    assert.equal(workload.kind, "Deployment");
    assert.equal(workload.name, "demo");
  });

  test("anything else is found as an ObjectRef", async () => {
    const h = new App("web", write({ "manifest.yaml": demo }));
    const source = await h.namespace().manifest("manifest.yaml");
    const config = source.find("ConfigMap", "demo-config");
    assert.equal(config.kind, "ConfigMap");
    assert.equal(config.name, "demo-config");
  });

  test("vpa on a found Workload or ObjectRef targets it, in the namespace it was rendered for", async () => {
    const h = new App("web", write({ "manifest.yaml": demo }));
    const source = await h.namespace().manifest("manifest.yaml");
    source.find("Deployment", "demo").vpa();
    source.find("ConfigMap", "demo-config").vpa({ advisory: true });
    const vpas = (await h.objects()).filter(
      (o) => o.kind === "VerticalPodAutoscaler",
    );
    assert.deepEqual(
      vpas.map((v) => [
        v.metadata.name,
        v.metadata.namespace,
        v.spec.targetRef.kind,
      ]),
      [
        ["demo", "web", "Deployment"],
        ["demo-config", "web", "ConfigMap"],
      ],
    );
    assert.equal(vpas[1].spec.updatePolicy.updateMode, "Off");
  });

  test("a found Workload's service uses its own selector, not the app.kubernetes.io/name convention", async () => {
    const h = new App("web", write({ "manifest.yaml": demo }));
    const source = await h.namespace().manifest("manifest.yaml");
    const service = source.find("Deployment", "demo").service({ http: 80 });
    assert.deepEqual(service.spec.selector, { app: "demo" });
  });

  test("a found Workload's containers and volumes are added to what it already has", async () => {
    const h = new App("web", write({ "manifest.yaml": demo }));
    const source = await h.namespace().manifest("manifest.yaml");
    source
      .find("Deployment", "demo")
      .addContainer("sidecar", { image: "sidecar:1" })
      .addVolume("data", { memory: {} });
    const [deployment] = withoutNamespace(await h.objects());
    assert.deepEqual(
      deployment.spec.template.spec.containers.map((c: any) => c.name),
      ["demo", "sidecar"],
    );
    assert.deepEqual(
      deployment.spec.template.spec.volumes.map((v: any) => v.name),
      ["data"],
    );
  });

  test("find fails when there's no match, naming what it looked for", async () => {
    const h = new App("web", write({ "manifest.yaml": demo }));
    const source = await h.namespace().manifest("manifest.yaml");
    assert.throws(
      () => source.find("Deployment", "missing"),
      /no object matches Deployment\/missing/,
    );
  });
});

describe("App.jsonnet", () => {
  test("evaluates a jsonnet file in the app's directory, and the app uses the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    writeFileSync(join(dir, "main.jsonnet"), "{ names: ['a', 'b'] }");
    const h = new App("web", dir);
    const ns = h.namespace();
    for (const name of (await ns.jsonnet("main.jsonnet")).names) {
      ns.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name } });
    }
    assert.deepEqual(await kinds(h), ["ConfigMap/a", "ConfigMap/b"]);
  });
});

describe("App.apps", () => {
  test("lists the apps beside this one by name, with the generated crds app", () => {
    const root = mkdtempSync(join(tmpdir(), "apps-"));
    dirs.push(root);
    for (const name of ["web", "db", "cache"]) {
      mkdirSync(join(root, name));
    }
    writeFileSync(join(root, "package.json"), "{}");
    assert.deepEqual(new App("web", join(root, "web")).apps, [
      "cache",
      "crds",
      "db",
      "web",
    ]);
  });
});

describe("namespaces", () => {
  const namespaces = async (h: App) =>
    withoutNamespace(await h.objects()).map(
      (o) => `${o.kind}/${o.metadata.name}=${o.metadata.namespace ?? ""}`,
    );

  test("a second Namespace can be declared for another name, without moving the app", async () => {
    const h = new App("cilium", "/apps/cilium");
    h.namespace();
    h.namespace({ name: "cilium-secrets", privileged: true });
    const objects = await h.objects();
    assert.deepEqual(
      objects.map((o) => o.metadata.name),
      ["cilium", "cilium-secrets"],
    );
    assert.equal(
      objects[1].metadata.labels["pod-security.kubernetes.io/enforce"],
      "privileged",
    );
  });

  describe("every helper that makes resources takes a namespace", () => {
    const other = "other";

    test("and gives the namespace it was created through to everything that isn't given one", async () => {
      const h = new App("web", "/apps/web");
      const ns = h.namespace();
      ns.configMap("c", {});
      ns.nasVolume("share");
      ns.deployment("d").addContainer("c", { image: "i" });
      ns.httpRoute("family", "a.example.test");
      ns.add({
        apiVersion: "v1",
        kind: "Named",
        metadata: { name: "n", namespace: "kept" },
      });
      ns.add({ apiVersion: "v1", kind: "Unnamed", metadata: { name: "u" } });
      const found = await namespaces(h);
      assert.ok(found.length > 5);
      assert.deepEqual(
        found.filter((f) => !f.endsWith("=web")),
        ["Named/n=kept"],
      );
    });

    test("whatever name the namespace is given", async () => {
      const h = new App("web", "/apps/web");
      const ns = h.namespace({ name: "elsewhere" });
      ns.configMap("c", {});
      ns.deployment("d");
      ns.httpRoute("family", "a.example.test");
      assert.ok((await namespaces(h)).every((f) => f.endsWith("=elsewhere")));
    });

    test("configMap", async () => {
      const h = new App("web", "/apps/web");
      h.namespace({ name: other }).configMap("c", { a: "b" });
      assert.deepEqual(await namespaces(h), [`ConfigMap/c=${other}`]);
    });

    test("nasVolume, whose cluster-scoped volume is given it too, as every object is", async () => {
      const h = new App("web", "/apps/web");
      h.namespace({ name: other }).nasVolume("share");
      assert.deepEqual(await namespaces(h), [
        `PersistentVolume/share=${other}`,
        `PersistentVolumeClaim/share=${other}`,
      ]);
    });

    test("workloads, and the services they make", async () => {
      const h = new App("web", "/apps/web");
      const ns = h.namespace({ name: other });
      const d = ns.deployment("d");
      d.addContainer("c", { image: "i" });
      d.service({ http: 80 });
      ns.statefulSet("s");
      ns.daemonSet("n");
      assert.deepEqual(await namespaces(h), [
        `Deployment/d=${other}`,
        `Service/d=${other}`,
        `StatefulSet/s=${other}`,
        `DaemonSet/n=${other}`,
      ]);
    });

    test("routes", async () => {
      const h = new App("web", "/apps/web");
      const ns = h.namespace({ name: other });
      ns.httpRoute("family", "http.example.test").match(
        { kind: "Service", name: "svc" },
        80,
      );
      ns.grpcRoute("family", "grpc.example.test", { timeout: "1m" }).match(
        { kind: "Service", name: "svc" },
        80,
      );
      ns.tcpRoute(
        "family",
        "tcp.example.test",
        22,
        { kind: "Service", name: "svc" },
        22,
      );
      ns.udpRoute(
        "family",
        "udp.example.test",
        53,
        { kind: "Service", name: "svc" },
        53,
      );
      const found = await namespaces(h);
      assert.equal(found.length, 2 + 3 + 2 + 2);
      assert.ok(
        found.every((f) => f.endsWith(`=${other}`)),
        found.join(", "),
      );
    });

    test("autoscalers", async () => {
      const h = new App("web", "/apps/web");
      h.namespace({ name: other }).vpa({ kind: "Deployment", name: "d" });
      assert.deepEqual(await namespaces(h), [
        `VerticalPodAutoscaler/d=${other}`,
      ]);
    });

    test("garage keys and buckets", async () => {
      const h = new App("web", "/apps/web");
      const ns = h.namespace({ name: other });
      const key = ns.garageKey("k");
      ns.garageBucket("b", [key]);
      assert.deepEqual(await namespaces(h), [
        `GarageKey/k=${other}`,
        `GarageReferenceGrant/${other}-web=garage`,
        `GarageBucket/b=${other}`,
      ]);
    });

    test("a grant for the cluster, widened as kinds are added", async () => {
      const grant = async (h: App) =>
        (await h.objects()).filter((o) => o.kind === "GarageReferenceGrant");

      const keys = new App("web", "/apps/web");
      const keysNs = keys.namespace({ name: other });
      keysNs.garageKey("k");
      keysNs.garageKey("l");
      assert.deepEqual(
        (await grant(keys)).map((g) => g.spec.from),
        [[{ kind: "GarageKey", namespace: other }]],
      );

      const both = new App("web", "/apps/web");
      const bothNs = both.namespace({ name: other });
      const key = bothNs.garageKey("k");
      bothNs.garageBucket("b", [key]);
      both.namespace({ name: "elsewhere" }).garageKey("m");
      const grants = await grant(both);
      assert.deepEqual(
        grants.map((g) => [g.metadata.name, g.metadata.namespace]),
        [
          [`${other}-web`, "garage"],
          ["elsewhere-web", "garage"],
        ],
      );
      assert.deepEqual(grants[0].spec.from, [
        { kind: "GarageKey", namespace: other },
        { kind: "GarageBucket", namespace: other },
      ]);
      assert.deepEqual(grants[0].spec.to, [
        { kind: "GarageCluster", name: "garage" },
      ]);
    });

    test("no grant within the cluster's own namespace", async () => {
      const h = new App("web", "/apps/web");
      h.namespace({ name: "garage" }).garageKey("k");
      assert.ok(
        !(await h.objects()).some((o) => o.kind === "GarageReferenceGrant"),
      );
    });

    test("secrets pushed through external secrets", async () => {
      const h = new App("web", "/apps/web");
      h.namespace({ name: other }).secrets("one", ["a"]);
      const objects = await h.objects();
      assert.equal(
        objects.find((o) => o.kind === "SecretStore")!.spec.provider.kubernetes
          .remoteNamespace,
        other,
      );
    });

    test("an assets server, with all that it makes", async () => {
      const h = new App("llama-cpp", "/apps/llama-cpp");
      const { url } = h.namespace({ name: other }).assetsServer();
      // the objects that push Secrets live in external-secrets-operator, and push into the namespace
      const pushes = /^(SecretStore|PushSecret)\//;
      const grants = (await namespaces(h)).filter((f) =>
        f.startsWith("GarageReferenceGrant/"),
      );
      assert.deepEqual(grants, [
        `GarageReferenceGrant/${other}-llama-cpp=garage`,
      ]);
      const found = (await namespaces(h)).filter(
        (f) => !pushes.test(f) && !f.startsWith("GarageReferenceGrant/"),
      );
      assert.ok(found.length > 5);
      assert.ok(
        found.every((f) => f.endsWith(`=${other}`)),
        found.join(", "),
      );
      const store = (await h.objects()).find((o) => o.kind === "SecretStore")!;
      assert.equal(store.spec.provider.kubernetes.remoteNamespace, other);
      assert.equal(url, `http://assets-server.${other}.svc:8080`);
    });

    describe("sources", () => {
      const sa = server.url("sa.yaml");

      test(
        "a kustomization is moved to the namespace it names, or the app's",
        { skip: !hasCommand("kustomize") && "kustomize is not installed" },
        async () => {
          const named = new App("web", "/apps/web");
          await named.namespace({ name: other }).kustomize(sa);
          assert.deepEqual(await namespaces(named), [
            `ServiceAccount/a=${other}`,
          ]);

          const own = new App("web", "/apps/web");
          await own.namespace().kustomize(sa);
          assert.deepEqual(await namespaces(own), ["ServiceAccount/a=web"]);
        },
      );
    });
  });
});

const hasHelm = hasCommand("helm");

describe(
  "helm in another namespace",
  { skip: !hasHelm && "helm is not installed" },
  () => {
    const cache = mkdtempSync(join(tmpdir(), "app-helm-cache-"));
    dirs.push(cache);
    process.env.HOMELAB_CACHE = cache;

    // a chart that is already in the cache is not downloaded
    const chart = join(cache, "charts", "example.test", "demo-1.0.0");
    mkdirSync(join(chart, "templates"), { recursive: true });
    writeFileSync(
      join(chart, "Chart.yaml"),
      "apiVersion: v2\nname: demo\nversion: 1.0.0\n",
    );
    writeFileSync(
      join(chart, "templates", "objects.yaml"),
      `apiVersion: v1
kind: ConfigMap
metadata:
  name: named
  namespace: {{ .Release.Namespace }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: unnamed
`,
    );
    const url = "https://example.test/demo?version=1.0.0";

    test("is rendered for the namespace it was created through, which objects that name none are given too", async () => {
      const h = new App("web", "/apps/web");
      await h.namespace().helm(url);
      assert.deepEqual(
        withoutNamespace(await h.objects()).map((o) => [
          o.metadata.name,
          o.metadata.namespace,
        ]),
        [
          ["named", "web"],
          ["unnamed", "web"],
        ],
      );
    });

    test("is rendered for another namespace the same way", async () => {
      const h = new App("web", "/apps/web");
      await h.namespace({ name: "other" }).helm(url);
      assert.deepEqual(
        withoutNamespace(await h.objects()).map((o) => [
          o.metadata.name,
          o.metadata.namespace,
        ]),
        [
          ["named", "other"],
          ["unnamed", "other"],
        ],
      );
    });
  },
);

describe("the objects an app publishes", () => {
  const thing = (
    metadata: Record<string, any>,
    more: Record<string, any> = {},
  ) => ({
    apiVersion: "v1",
    kind: "Thing",
    metadata,
    ...more,
  });

  test("have a null creationTimestamp, and empty labels and annotations, dropped", async () => {
    const h = new App("web", "/apps/web");
    h.namespace().add(
      thing({
        name: "x",
        creationTimestamp: null,
        labels: {},
        annotations: {},
      }),
    );
    const [object] = withoutNamespace(await h.objects());
    assert.deepEqual(object.metadata, { name: "x", namespace: "web" });
  });

  test("keep everything else", async () => {
    const h = new App("web", "/apps/web");
    h.namespace().add(
      thing({
        name: "x",
        labels: { a: "b" },
        creationTimestamp: "2020-01-01T00:00:00Z",
      }),
    );
    const [object] = withoutNamespace(await h.objects());
    assert.deepEqual(object.metadata, {
      name: "x",
      namespace: "web",
      labels: { a: "b" },
      creationTimestamp: "2020-01-01T00:00:00Z",
    });
  });

  test("are tidied after the hooks, which can add what is dropped", async () => {
    const h = new App("web", "/apps/web");
    h.namespace().add(thing({ name: "x" }));
    h.postRender((e) => {
      e.find({ kind: "Thing", name: "x" }).metadata.labels = {};
    });
    const [object] = withoutNamespace(await h.objects());
    assert.equal("labels" in object.metadata, false);
  });

  test("are stamped with a namespace, cluster-scoped ones included", async () => {
    const h = new App("web", "/apps/web");
    const ns = h.namespace();
    ns.add({ apiVersion: "v1", kind: "ClusterRole", metadata: { name: "a" } });
    ns.add(thing({ name: "b", namespace: "other" }));
    assert.deepEqual(
      withoutNamespace(await h.objects()).map((o) => o.metadata.namespace),
      ["web", "other"],
    );
  });

  test("must each have an apiVersion, a kind and a name, and the error names the app's file", async () => {
    const without = async (object: Record<string, any>) => {
      const h = new App("web", "/apps/web");
      h.namespace().add(object);
      return h.objects();
    };
    await assert.rejects(
      () => without({ kind: "Thing", metadata: { name: "x" } }),
      /\/apps\/web\/app\.ts: object 1 has no 'apiVersion'/,
    );
    await assert.rejects(
      () => without({ apiVersion: "v1", metadata: { name: "x" } }),
      /object 1 has no 'kind'/,
    );
    await assert.rejects(
      () => without({ apiVersion: "v1", kind: "Thing", metadata: {} }),
      /Thing \(object 1\) has no 'metadata.name'/,
    );
  });

  test("are checked before the hooks run", async () => {
    const h = new App("web", "/apps/web");
    h.namespace().add({ kind: "Thing", metadata: { name: "x" } });
    let ran = false;
    h.postRender(() => {
      ran = true;
    });
    assert.throws(() => h.objects(), /has no 'apiVersion'/);
    assert.equal(ran, false);
  });
});
