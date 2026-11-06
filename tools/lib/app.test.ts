import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { App } from "./app.ts";
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

const kinds = async (h: App) =>
  (await h.objects()).map((o) => `${o.kind}/${o.metadata.name}`);

describe("App", () => {
  test("collects everything created through it, in creation order", async () => {
    const h = new App("web", "/apps/web");
    h.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "one" } });
    const workload = h
      .deployment("web")
      .addContainer("web", { image: "image:1" });
    workload.service({ http: 80 });
    h.vpa(workload);
    assert.deepEqual(await kinds(h), [
      "ConfigMap/one",
      "Deployment/web",
      "Service/web",
      "VerticalPodAutoscaler/web",
    ]);
  });

  test("builds a workload when the app finishes, so later containers are included", async () => {
    const h = new App("web", "/apps/web");
    const workload = h.statefulSet("web");
    workload.addContainer("first", { image: "image:1" });
    workload.addContainer("second", { image: "image:2" });
    const [object] = await h.objects();
    assert.deepEqual(
      object.spec.template.spec.containers.map((c: any) => c.name),
      ["first", "second"],
    );
  });

  test("builds a route when the app finishes, so later matches are included", async () => {
    const h = new App("web", "/apps/web");
    const service = h.deployment("web").service({ http: 80 });
    const route = h.httpRoute("family", "web.fiola.dev");
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
    const workload = h.deployment("web");
    h.tcpRoute(
      "family",
      "web.fiola.dev",
      9000,
      { kind: "Service", name: "web" },
      9000,
    );
    h.vpa(workload);
    h.vpa(
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
      const h = await via("web", (h) => h.secrets("credentials", ["token"]));
      const objects = await h.objects();
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
      let credentials: ReturnType<App["secrets"]> | undefined;
      await via("web", (h) => {
        credentials = h.secrets("credentials", ["token"]);
      });
      assert.deepEqual((credentials as any).key("token"), {
        secretKeyRef: { name: "credentials", key: "token" },
      });
    });

    test("an app that names its namespace is pushed to that namespace", async () => {
      const h = await via("web", (h) => {
        h.namespaceName = "elsewhere";
        h.secrets("credentials", ["token"]);
      });
      const [store, push] = await h.objects();
      assert.equal(store.spec.provider.kubernetes.remoteNamespace, "elsewhere");
      assert.equal(push.metadata.name, "elsewhere-credentials");
    });

    test("the store is added once, however many Secrets are pushed", async () => {
      const h = await via("mail", (h) => {
        h.secrets("one", ["a"]);
        h.templatedSecrets("two", { B: h.secretRef("b") });
      });
      assert.deepEqual(await kinds(h), [
        "SecretStore/mail",
        "PushSecret/mail-one",
        "PushSecret/mail-two",
      ]);
    });

    test("a Secret can be put in another namespace, which gets a store of its own", async () => {
      const h = await via("cilium", (h) => {
        h.namespaceName = "cilium";
        h.secrets("credentials", ["a"]);
        h.secrets("elsewhere-credentials", ["a"], {
          namespace: "cilium-secrets",
        });
        h.templatedSecrets(
          "rendered",
          { B: h.secretRef("b") },
          {
            namespace: "cilium-secrets",
          },
        );
      });
      const objects = await h.objects();
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
        h.secrets("shared", ["token"], { from: "shared-app" });
      });
      const push = (await h.objects())[1];
      assert.equal(
        push.spec.template.data.token,
        secretRef("token", "shared-app"),
      );
    });

    test("the same Secret can't be pushed twice", async () => {
      await assert.rejects(
        async () =>
          via("mail", (h) => {
            h.secrets("one", ["a"]);
            h.templatedSecrets("one", { B: h.secretRef("b") });
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
      const h = await via("llama-cpp", (h) => h.assetsServer());
      const objects = await h.objects();
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
      const named = async (namespace?: string) => {
        const h = new App("llama-cpp", "/apps/llama-cpp");
        if (namespace) h.namespaceName = namespace;
        return h.assetsServer().url;
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
    const config = h.configMap("web-config", h.files("a.conf"));
    assert.equal(config.metadata.name, "web-config");
    assert.deepEqual(config.data, { "a.conf": "hello\n" });
    assert.deepEqual(await kinds(h), ["ConfigMap/web-config"]);
  });

  test("nasVolume adds a volume and its claim", async () => {
    const h = new App("web", "/apps/web");
    h.nasVolume("media");
    assert.deepEqual(await kinds(h), [
      "PersistentVolume/media",
      "PersistentVolumeClaim/media",
    ]);
  });
});

describe("App.namespace", () => {
  test("creates the app's namespace, privileged on request", async () => {
    const [plain] = await new App("web", "/apps/web").namespace().objects();
    assert.deepEqual(plain.metadata, { name: "web", namespace: "web" });
    const [privileged] = await new App("web", "/apps/web")
      .namespace({ privileged: true })
      .objects();
    assert.equal(
      privileged.metadata.labels["pod-security.kubernetes.io/enforce"],
      "privileged",
    );
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

  test("adds the objects of a manifest in the app's directory, without waiting", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "after" } });
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
      h.kustomize(server.url("deployment.yaml"), { namespace: "moved" });
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
      h.kustomize(server.url("deployment.yaml"), {
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

  test("a missing manifest fails when the app is built, not when it is declared", async () => {
    const h = new App("web", write({}));
    h.manifest("missing.yaml");
    await assert.rejects(() => h.objects(), /missing\.yaml/);
  });

  test("post-render hooks change the objects they find, whatever added them", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.postRender((e) => {
      e.find({
        kind: "Deployment",
        name: "web",
      }).spec.template.spec.containers[0].image = "web:2";
    });
    h.manifest("manifest.yaml");
    const [d] = await h.objects();
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
    h.configMap("c", {});
    h.configMap("d", {});
    const objects = await h.objects();
    assert.deepEqual(seen, ["first", "second"]);
    assert.deepEqual(objects[0].data, { first: "1", second: "1d" });
  });

  test("one hook can change several objects", async () => {
    const h = new App("web", write({}));
    h.configMap("a", {});
    h.configMap("b", {});
    h.postRender((e) => {
      for (const c of [
        e.find({ kind: "ConfigMap", name: "a" }),
        e.find({ kind: "ConfigMap", name: "b" }),
      ]) {
        c.data = { changed: "yes" };
      }
    });
    assert.deepEqual(
      (await h.objects()).map((o) => o.data),
      [{ changed: "yes" }, { changed: "yes" }],
    );
  });

  test("hooks don't accumulate when the objects are read twice, whether a source or an add made them", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.add({
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
    h.add(added);
    h.postRender((e) => {
      e.find({ kind: "Thing", name: "t" }).spec.n = 2;
    });
    const [thing] = await h.objects();
    assert.equal(thing.spec.n, 2);
    assert.equal(added.spec.n, 1);
  });

  test("a hook that finds nothing is an error naming the app, so a changed upstream is noticed", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.postRender((e) => {
      e.find({ kind: "Deployment", name: "renamed" });
    });
    await assert.rejects(
      () => h.objects(),
      /^Error: web: no object matches Deployment\/renamed$/,
    );
  });

  test("a hook can select by api group", async () => {
    const h = new App("web", write({ "manifest.yaml": deployment }));
    h.manifest("manifest.yaml");
    h.postRender((e) => {
      e.find({ kind: "Deployment", name: "web", group: "extensions" });
    });
    await assert.rejects(
      () => h.objects(),
      /web: no object matches extensions\/Deployment\/web/,
    );
  });
});

describe("App.jsonnet", () => {
  test("evaluates a jsonnet file in the app's directory, and the app uses the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    dirs.push(dir);
    writeFileSync(join(dir, "main.jsonnet"), "{ names: ['a', 'b'] }");
    const h = new App("web", dir);
    for (const name of (await h.jsonnet("main.jsonnet")).names) {
      h.add({ apiVersion: "v1", kind: "ConfigMap", metadata: { name } });
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
    (await h.objects()).map(
      (o) => `${o.kind}/${o.metadata.name}=${o.metadata.namespace ?? ""}`,
    );

  describe("namespaceName", () => {
    test("is the app's name, unless it is set before anything is added", async () => {
      const h = new App("web", "/apps/web");
      assert.equal(h.namespaceName, "web");
      h.namespaceName = "elsewhere";
      assert.equal(h.namespaceName, "elsewhere");
      h.namespace();
      assert.deepEqual(await namespaces(h), ["Namespace/elsewhere=elsewhere"]);
    });

    test("can't be set once something was added, however it was added", () => {
      const adders: [string, (h: App) => unknown][] = [
        [
          "add",
          (h) =>
            h.add({ apiVersion: "v1", kind: "A", metadata: { name: "a" } }),
        ],
        ["namespace", (h) => h.namespace()],
        ["deployment", (h) => h.deployment("web")],
        ["httpRoute", (h) => h.httpRoute("family", "a.example.test")],
        ["configMap", (h) => h.configMap("c", {})],
        ["vpa", (h) => h.vpa({ kind: "Deployment", name: "web" })],
      ];
      for (const [name, add] of adders) {
        const h = new App("web", "/apps/web");
        add(h);
        assert.throws(
          () => {
            h.namespaceName = "late";
          },
          /namespaceName is set after something was added \(which used web\)/,
          name,
        );
        assert.equal(h.namespaceName, "web", name);
      }
    });
  });

  test("a Namespace can be made for another name, without moving the app", async () => {
    const h = new App("cilium", "/apps/cilium");
    h.namespace().namespace({ name: "cilium-secrets", privileged: true });
    const objects = await h.objects();
    assert.deepEqual(
      objects.map((o) => o.metadata.name),
      ["cilium", "cilium-secrets"],
    );
    assert.equal(
      objects[1].metadata.labels["pod-security.kubernetes.io/enforce"],
      "privileged",
    );
    assert.equal(h.namespaceName, "cilium");
  });

  describe("every helper that makes resources takes a namespace", () => {
    const other = "other";

    test("and gives the app's namespace to everything that isn't given one", async () => {
      const h = new App("web", "/apps/web");
      h.configMap("c", {});
      h.nasVolume("share");
      h.deployment("d").addContainer("c", { image: "i" });
      h.httpRoute("family", "a.example.test");
      h.add({
        apiVersion: "v1",
        kind: "Named",
        metadata: { name: "n", namespace: "kept" },
      });
      h.add({ apiVersion: "v1", kind: "Unnamed", metadata: { name: "u" } });
      const found = await namespaces(h);
      assert.ok(found.length > 5);
      assert.deepEqual(
        found.filter((f) => !f.endsWith("=web")),
        ["Named/n=kept"],
      );
    });

    test("whatever the app's namespace is set to before anything is added", async () => {
      const h = new App("web", "/apps/web");
      h.namespaceName = "elsewhere";
      h.configMap("c", {});
      h.deployment("d");
      h.httpRoute("family", "a.example.test");
      assert.ok((await namespaces(h)).every((f) => f.endsWith("=elsewhere")));
    });

    test("configMap", async () => {
      const h = new App("web", "/apps/web");
      h.configMap("c", { a: "b" }, { namespace: other });
      assert.deepEqual(await namespaces(h), [`ConfigMap/c=${other}`]);
    });

    test("nasVolume, whose cluster-scoped volume is given it too, as every object is", async () => {
      const h = new App("web", "/apps/web");
      h.nasVolume("share", { namespace: other });
      assert.deepEqual(await namespaces(h), [
        `PersistentVolume/share=${other}`,
        `PersistentVolumeClaim/share=${other}`,
      ]);
    });

    test("workloads, and the services they make", async () => {
      const h = new App("web", "/apps/web");
      const d = h.deployment("d", { namespace: other });
      d.addContainer("c", { image: "i" });
      d.service({ http: 80 });
      h.statefulSet("s", { namespace: other });
      h.daemonSet("n", { namespace: other });
      assert.deepEqual(await namespaces(h), [
        `Deployment/d=${other}`,
        `Service/d=${other}`,
        `StatefulSet/s=${other}`,
        `DaemonSet/n=${other}`,
      ]);
    });

    test("routes", async () => {
      const h = new App("web", "/apps/web");
      h.httpRoute("family", "http.example.test", { namespace: other }).match(
        { kind: "Service", name: "svc" },
        80,
      );
      h.grpcRoute("family", "grpc.example.test", {
        namespace: other,
        timeout: "1m",
      }).match({ kind: "Service", name: "svc" }, 80);
      h.tcpRoute(
        "family",
        "tcp.example.test",
        22,
        { kind: "Service", name: "svc" },
        22,
        {
          namespace: other,
        },
      );
      h.udpRoute(
        "family",
        "udp.example.test",
        53,
        { kind: "Service", name: "svc" },
        53,
        {
          namespace: other,
        },
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
      h.vpa({ kind: "Deployment", name: "d" }, { namespace: other });
      assert.deepEqual(await namespaces(h), [
        `VerticalPodAutoscaler/d=${other}`,
      ]);
    });

    test("garage keys and buckets", async () => {
      const h = new App("web", "/apps/web");
      const key = h.garageKey("k", { namespace: other });
      h.garageBucket("b", [key], { namespace: other });
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
      keys.garageKey("k", { namespace: other });
      keys.garageKey("l", { namespace: other });
      assert.deepEqual((await grant(keys)).map((g) => g.spec.from), [
        [{ kind: "GarageKey", namespace: other }],
      ]);

      const both = new App("web", "/apps/web");
      const key = both.garageKey("k", { namespace: other });
      both.garageBucket("b", [key], { namespace: other });
      both.garageKey("m", { namespace: "elsewhere" });
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
      h.garageKey("k", { namespace: "garage" });
      assert.ok(
        !(await h.objects()).some((o) => o.kind === "GarageReferenceGrant"),
      );
    });

    test("secrets pushed through external secrets", async () => {
      const h = new App("web", "/apps/web");
      h.secrets("one", ["a"], { namespace: other });
      const objects = await h.objects();
      assert.equal(
        objects.find((o) => o.kind === "SecretStore")!.spec.provider.kubernetes
          .remoteNamespace,
        other,
      );
    });

    test("an assets server, with all that it makes", async () => {
      const h = new App("llama-cpp", "/apps/llama-cpp");
      const { url } = h.assetsServer({ namespace: other });
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
          named.kustomize(sa, { namespace: other });
          assert.deepEqual(await namespaces(named), [
            `ServiceAccount/a=${other}`,
          ]);

          const own = new App("web", "/apps/web");
          own.kustomize(sa);
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

    test("is rendered for the app's namespace, which objects that name none are given too", async () => {
      const h = new App("web", "/apps/web");
      h.helm(url);
      assert.deepEqual(
        (await h.objects()).map((o) => [o.metadata.name, o.metadata.namespace]),
        [
          ["named", "web"],
          ["unnamed", "web"],
        ],
      );
    });

    test("is rendered for the namespace it is given, which objects that name none are given too", async () => {
      const h = new App("web", "/apps/web");
      h.helm(url, { namespace: "other" });
      assert.deepEqual(
        (await h.objects()).map((o) => [o.metadata.name, o.metadata.namespace]),
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
    h.add(
      thing({
        name: "x",
        creationTimestamp: null,
        labels: {},
        annotations: {},
      }),
    );
    const [object] = await h.objects();
    assert.deepEqual(object.metadata, { name: "x", namespace: "web" });
  });

  test("keep everything else", async () => {
    const h = new App("web", "/apps/web");
    h.add(
      thing({
        name: "x",
        labels: { a: "b" },
        creationTimestamp: "2020-01-01T00:00:00Z",
      }),
    );
    const [object] = await h.objects();
    assert.deepEqual(object.metadata, {
      name: "x",
      namespace: "web",
      labels: { a: "b" },
      creationTimestamp: "2020-01-01T00:00:00Z",
    });
  });

  test("are tidied after the hooks, which can add what is dropped", async () => {
    const h = new App("web", "/apps/web");
    h.add(thing({ name: "x" }));
    h.postRender((e) => {
      e.find({ kind: "Thing", name: "x" }).metadata.labels = {};
    });
    const [object] = await h.objects();
    assert.equal("labels" in object.metadata, false);
  });

  test("are stamped with a namespace, cluster-scoped ones included", async () => {
    const h = new App("web", "/apps/web");
    h.add({ apiVersion: "v1", kind: "ClusterRole", metadata: { name: "a" } });
    h.add(thing({ name: "b", namespace: "other" }));
    assert.deepEqual(
      (await h.objects()).map((o) => o.metadata.namespace),
      ["web", "other"],
    );
  });

  test("must each have an apiVersion, a kind and a name, and the error names the app's file", async () => {
    const without = async (object: Record<string, any>) => {
      const h = new App("web", "/apps/web");
      h.add(object);
      return h.objects();
    };
    await assert.rejects(
      () => without({ kind: "Thing", metadata: { name: "x" } }),
      /\/apps\/web\/app\.ts: object 0 has no 'apiVersion'/,
    );
    await assert.rejects(
      () => without({ apiVersion: "v1", metadata: { name: "x" } }),
      /object 0 has no 'kind'/,
    );
    await assert.rejects(
      () => without({ apiVersion: "v1", kind: "Thing", metadata: {} }),
      /Thing \(object 0\) has no 'metadata.name'/,
    );
  });

  test("are checked before the hooks run", async () => {
    const h = new App("web", "/apps/web");
    h.add({ kind: "Thing", metadata: { name: "x" } });
    let ran = false;
    h.postRender(() => {
      ran = true;
    });
    await assert.rejects(() => h.objects(), /has no 'apiVersion'/);
    assert.equal(ran, false);
  });
});
