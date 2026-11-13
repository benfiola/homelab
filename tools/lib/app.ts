import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crdsApp, fluxDeclaration, listApps, networkFunction } from "./apps.ts";
import { helmImage, images } from "./images.ts";
import { editor, type Editor } from "./k8s/edit.ts";
import type { FluxDeclaration } from "./k8s/flux.ts";
import {
  bucketSyncPolicy,
  garageBucket,
  garageCluster,
  garageEndpoint,
  garageKey,
  garageReferenceGrant,
  type GarageBucketOptions,
  type GarageKey,
  type GarageKeyOptions,
} from "./k8s/garage.ts";
import type { NetworkFunction } from "./k8s/network-policy.ts";
import {
  GrpcRoute,
  HttpRoute,
  tcpRoute,
  udpRoute,
  type Gateway,
  type Target as RouteTarget,
} from "./k8s/routes.ts";
import {
  appSecrets,
  appTemplatedSecrets,
  bucketSyncKeys,
  generatedRef,
  type GeneratedName,
  pushStore,
  secretKeys,
  secretRef,
  type SecretKeys,
} from "./k8s/secrets.ts";
import { podMonitor, Service, type MonitorOptions } from "./k8s/monitoring.ts";
import { nasVolume } from "./k8s/storage.ts";
import { volsyncBackup, type VolsyncBackupOptions } from "./k8s/volsync.ts";
import {
  probes,
  securityContext,
  vpa,
  Workload,
  workloadKinds,
  type ProbeTarget,
  type ProbesOptions,
  type SecurityContextOptions,
  type VpaOptions,
  type VpaTarget,
  type WorkloadKind,
  type WorkloadOptions,
} from "./k8s/workload.ts";
import { stampNamespace } from "./object.ts";
import { helm, parseChartUrl } from "./sources/helm.ts";
import { jsonnet } from "./sources/jsonnet.ts";
import { kustomize } from "./sources/kustomize.ts";
import { manifest, remoteText } from "./sources/manifest.ts";

type Obj = Record<string, any>;

export type { Service } from "./k8s/monitoring.ts";
export type { Env, Workload } from "./k8s/workload.ts";

export interface ConfigMapOptions {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface KustomizeSourceOptions {
  // added to every object, and to the selectors and pod templates that match them
  labels?: Record<string, string>;
}

export interface HelmSourceOptions {
  // defaults to the chart's name
  release?: string;
  values?: Obj;
  // include the chart's crds (default true)
  crds?: boolean;
  kubeVersion?: string;
}

// the type of an app's exported `app`; it types `h`
export type AppFunction = (h: App) => void | Promise<void>;

type Resource = Obj | Workload | HttpRoute | GrpcRoute;

// the handle an app's `app.ts` receives: constants and utilities that apply across every
// namespace. everything that creates a resource lives on `Namespace` instead (see `namespace()`)
export class App {
  readonly app: string;
  readonly dir: string;

  // every app, the generated crds app included, by name
  get apps(): string[] {
    return [...listApps(dirname(this.dir)), crdsApp].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  // the app's `export const flux`, if any
  fluxDeclaration(app: string): Promise<FluxDeclaration | undefined> {
    return fluxDeclaration(dirname(this.dir), app);
  }

  // the app's `export const network`, if any
  networkFunction(app: string): Promise<NetworkFunction | undefined> {
    return networkFunction(dirname(this.dir), app);
  }

  readonly images = images;
  readonly helmImage = helmImage;
  readonly timezone = "America/Los_Angeles";

  // everything added, with the namespace it was added for
  private readonly resources: { resource: Resource; namespace: string }[] = [];
  private readonly hooks: ((e: Editor) => void)[] = [];
  private readonly pushStores = new Set<string>();
  private readonly pushed = new Set<string>();
  private readonly garageGrants = new Map<string, Obj>();

  constructor(app: string, dir: string) {
    this.app = app;
    this.dir = dir;
  }

  // restricted security contexts, the default for workloads
  securityContext(opts?: SecurityContextOptions) {
    return securityContext(opts);
  }

  probes(target: ProbeTarget, opts?: ProbesOptions) {
    return probes(target, opts);
  }

  // declares a Namespace (the app's own, or another by `name`) and returns the handle everything
  // else is created through. `privileged` lifts pod security admission, for apps needing host
  // access; `external` skips declaring it, for a namespace another app already owns
  namespace(
    opts: { name?: string; privileged?: boolean; external?: boolean } = {},
  ): Namespace {
    const name = opts.name ?? this.app;
    if (!opts.external) {
      this.track(
        {
          apiVersion: "v1",
          kind: "Namespace",
          metadata: {
            name,
            ...(opts.privileged && {
              labels: { "pod-security.kubernetes.io/enforce": "privileged" },
            }),
          },
        },
        name,
      );
    }
    return new Namespace(this, name);
  }

  // queues something to build when the app finishes, in `namespace`. not part of the api an
  // app.ts uses directly: `Namespace`'s methods call this on the app's behalf
  track(resource: Resource, namespace: string): void {
    this.resources.push({ resource, namespace });
  }

  // the objects that push Secrets into a namespace, and the store they push through (one per
  // namespace)
  push(namespace: string, objects: Obj[]): void {
    for (const { metadata } of objects) {
      if (this.pushed.has(metadata.name)) {
        throw new Error(
          `${this.app} pushes the Secret behind ${metadata.name} twice: give each Secret a name of its own`,
        );
      }
      this.pushed.add(metadata.name);
    }
    if (!this.pushStores.has(namespace)) {
      this.pushStores.add(namespace);
      this.track(pushStore(namespace), namespace);
    }
    objects.forEach((object) => this.track(object, namespace));
  }

  // lets a namespace's garage resources of `kind` reference the cluster: one grant per namespace,
  // widened as kinds are added, and named for the app too, so apps sharing a namespace don't share one
  grantGarage(namespace: string, kind: string): void {
    if (namespace === garageCluster.namespace) {
      return;
    }
    let grant = this.garageGrants.get(namespace);
    if (!grant) {
      grant = garageReferenceGrant(namespace, this.app);
      this.garageGrants.set(namespace, grant);
      this.track(grant, garageCluster.namespace);
    }
    if (!grant.spec.from.some((f: Obj) => f.kind === kind)) {
      grant.spec.from.push({ kind, namespace });
    }
  }

  // the data of a jsonnet file of the app's directory (with its jsonnetfile.json libraries)
  jsonnet(file: string): Promise<any> {
    return jsonnet(file, this.dir);
  }

  // edits the built objects once the app is complete, whichever way they were made. the editor
  // fails when it finds nothing, so that a changed upstream is noticed
  postRender(hook: (e: Editor) => void): this {
    this.hooks.push(hook);
    return this;
  }

  // refers to a key of the app's secrets, inside a `templatedSecrets` template
  secretRef(key: string): string {
    return secretRef(key, this.app);
  }

  // a generated value, inside a `templatedSecrets` template
  generatedRef(name: GeneratedName): string {
    return generatedRef(name);
  }

  // the contents of files in the app's directory, keyed by file name
  files(...names: string[]): Record<string, string> {
    return Object.fromEntries(
      names.map((name) => [name, readFileSync(join(this.dir, name), "utf-8")]),
    );
  }

  // the text at a url, downloaded once and cached. the url must be pinned (a tag or a commit), as
  // what it holds is never refetched
  fetch(url: string): Promise<string> {
    return remoteText(url);
  }

  // what the app publishes: everything it created, in creation order, after the post-render hooks
  objects(): Obj[] {
    const objects = this.resources
      .map(({ resource, namespace }) => {
        const built = build(resource);
        // a copy, so that hooks never change what was added, or accumulate over repeated calls
        return stampNamespace(structuredClone(built), namespace);
      })
      .flat();

    validate(join(this.dir, "app.ts"), objects);

    const e = editor(objects);
    for (const hook of this.hooks) {
      try {
        hook(e);
      } catch (error: any) {
        throw new Error(`${this.app}: ${error.message}`);
      }
    }
    return tidy(objects);
  }
}

// a namespace an app declared (see `App.namespace`): everything created through it lands here.
// its name is what gets stamped onto every object it creates - there is no other default
export class Namespace {
  readonly name: string;
  private readonly app: App;

  constructor(app: App, name: string) {
    this.app = app;
    this.name = name;
  }

  // the data of a jsonnet file of the app's directory (with its jsonnetfile.json libraries)
  jsonnet(file: string): Promise<any> {
    return this.app.jsonnet(file);
  }

  add(...objects: Obj[]): this {
    objects.forEach((object) => this.app.track(object, this.name));
    return this;
  }

  // adds the objects of a helm chart: `<repository url>/<chart>?version=<version>` (see
  // parseChartUrl); the handle finds one of its objects. await it: `await ns.helm(chart)`
  async helm(chart: string, opts: HelmSourceOptions = {}): Promise<Source> {
    // objects the chart leaves without a namespace are given the one it was rendered for
    const objects = stampNamespace(
      await helm({ ...parseChartUrl(chart), ...opts }, this.name),
      this.name,
    );
    this.add(...objects);
    return new Source(objects, (object) => this.app.track(object, this.name));
  }

  // adds the objects of a manifest: a url, or a path relative to the app's directory; the
  // handle finds one of its objects. await it: `await ns.manifest(source)`
  async manifest(source: string): Promise<Source> {
    const objects = stampNamespace(
      await manifest(source, this.app.dir),
      this.name,
    );
    this.add(...objects);
    return new Source(objects, (object) => this.app.track(object, this.name));
  }

  // adds the objects of an upstream kustomize overlay (a git url), or of a manifest at a url
  // that needs changing; the handle finds one of its objects. await it: `await ns.kustomize(source)`
  async kustomize(
    source: string,
    opts: KustomizeSourceOptions = {},
  ): Promise<Source> {
    const objects = stampNamespace(
      await kustomize(source, { namespace: this.name, labels: opts.labels }),
      this.name,
    );
    this.add(...objects);
    return new Source(objects, (object) => this.app.track(object, this.name));
  }

  private workload(
    kind: WorkloadKind,
    name: string,
    opts: WorkloadOptions = {},
  ) {
    const workload = new Workload(kind, name, opts, (object) =>
      this.app.track(object, this.name),
    );
    this.app.track(workload, this.name);
    return workload;
  }

  statefulSet(name: string, opts?: WorkloadOptions) {
    return this.workload("StatefulSet", name, opts);
  }

  deployment(name: string, opts?: WorkloadOptions) {
    return this.workload("Deployment", name, opts);
  }

  daemonSet(name: string, opts?: WorkloadOptions) {
    return this.workload("DaemonSet", name, opts);
  }

  // an https route (with its listener); add where it sends traffic with `.match()`
  httpRoute(gateway: Gateway, hostname: string) {
    const route = new HttpRoute(gateway, hostname);
    this.app.track(route, this.name);
    return route;
  }

  grpcRoute(
    gateway: Gateway,
    hostname: string,
    opts: { timeout?: string } = {},
  ) {
    const route = new GrpcRoute(gateway, hostname, opts);
    this.app.track(route, this.name);
    return route;
  }

  tcpRoute(
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
  ): this {
    tcpRoute(gateway, hostname, fromPort, to, toPort).forEach((object) =>
      this.app.track(object, this.name),
    );
    return this;
  }

  udpRoute(
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
  ): this {
    udpRoute(gateway, hostname, fromPort, to, toPort).forEach((object) =>
      this.app.track(object, this.name),
    );
    return this;
  }

  // scrapes pods that no Workload made (an operator's, say): those labelled `selector`, on the
  // container port named `port`. pods made through a Workload use `Workload.podMonitor` instead
  podMonitor(
    name: string,
    selector: Record<string, string>,
    port: string,
    opts?: MonitorOptions,
  ): this {
    return this.add(podMonitor(name, selector, port, opts));
  }

  vpa(target: VpaTarget | { target: VpaTarget }, opts?: VpaOptions): this {
    return this.add(vpa("target" in target ? target.target : target, opts));
  }

  // a Secret holding keys of the app's section of the `apps` secret, and the handle to read its
  // keys through. `from` (another app's section) overrides the default
  secrets<K extends string>(
    name: string,
    keys: readonly K[],
    opts: { from?: string } = {},
  ): SecretKeys<K> {
    this.app.push(
      this.name,
      appSecrets(this.app.app, name, keys, { ...opts, namespace: this.name }),
    );
    return secretKeys(name, keys);
  }

  // the same, with the Secret's keys built from templates
  templatedSecrets<K extends string>(
    name: string,
    templates: Record<K, string>,
  ): SecretKeys<K> {
    this.app.push(
      this.name,
      appTemplatedSecrets(this.app.app, name, templates, {
        namespace: this.name,
      }),
    );
    return secretKeys(name, Object.keys(templates) as K[]);
  }

  configMap(
    name: string,
    data: Record<string, string>,
    opts: ConfigMapOptions = {},
  ): Obj {
    const { labels, annotations } = opts;
    const object = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: {
        name,
        ...(labels && { labels }),
        ...(annotations && { annotations }),
      },
      data,
    };
    this.app.track(object, this.name);
    return object;
  }

  // a share on the nas: a PersistentVolume and its claim (mount it with `{ pvc: { name } }`)
  nasVolume(name: string): this {
    nasVolume(name).forEach((object) => this.app.track(object, this.name));
    return this;
  }

  // backs up a PVC to backblaze, with the credentials in volsync's section of the `apps` file
  volumeBackup(pvc: string, opts: VolsyncBackupOptions = {}): this {
    const { secret, source } = volsyncBackup(pvc, this.name, opts);
    this.app.push(
      this.name,
      appTemplatedSecrets(this.app.app, secret.name, secret.templates, {
        namespace: this.name,
      }),
    );
    this.app.track(source, this.name);
    return this;
  }

  // a garage access key; unless imported it is generated into a Secret named `garage-key-garage-<name>`
  garageKey(name: string, opts: GarageKeyOptions = {}): GarageKey {
    const key = garageKey(name, opts);
    this.app.track(key.object, this.name);
    this.app.grantGarage(this.name, key.object.kind);
    return key;
  }

  // a garage bucket: `owners` own it, and `opts` grant other keys read-write or read-only access
  garageBucket(
    name: string,
    owners: GarageKey[],
    opts: GarageBucketOptions = {},
  ): Obj {
    const bucket = garageBucket(name, owners, opts);
    this.app.track(bucket, this.name);
    this.app.grantGarage(this.name, bucket.kind);
    return bucket;
  }

  // serves files synced from backblaze into a garage bucket named after the app (bucket, keys,
  // sync policy, and a read-only rclone server). returns the in-cluster url
  assetsServer(opts: { syncTimeout?: string } = {}): { url: string } {
    const name = `${this.app.app}-assets`;
    const key = garageKey(name);
    const readKey = garageKey(`${name}-read`);
    const bucket = garageBucket(name, [key], { roKeys: [readKey] });
    [key.object, readKey.object, bucket].forEach((o) =>
      this.app.grantGarage(this.name, o.kind),
    );
    const credentials = `bucket-sync-${name}`;

    const objects = [
      key.object,
      readKey.object,
      bucket,
      bucketSyncPolicy({
        bucket: name,
        key,
        source: `homelab-assets-698966/${this.app.app}`,
        credentials,
        syncTimeout: opts.syncTimeout,
      }),
    ];
    objects.forEach((object) => this.app.track(object, this.name));
    // bucket-sync's backblaze credentials are in a section of their own
    this.app.push(
      this.name,
      appSecrets(this.app.app, credentials, bucketSyncKeys, {
        namespace: this.name,
        from: "bucket-sync",
      }),
    );

    const server = this.deployment("assets-server").addContainer("rclone", {
      image: this.app.images.rclone,
      containerPorts: { http: 8080 },
      args: ["serve", "http", `source:${name}`, "--addr=:8080"],
      // listing the bucket also proves garage is reachable. liveness is only the socket: restarting
      // rclone wouldn't fix garage
      ...this.app.probes(
        { tcp: { port: 8080 } },
        { ready: { http: { path: "/", port: 8080 } }, startup: false },
      ),
      env: {
        RCLONE_CONFIG_SOURCE_TYPE: "s3",
        RCLONE_CONFIG_SOURCE_PROVIDER: "Other",
        RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID: {
          secretKeyRef: { name: readKey.secret, key: readKey.accessKeyIdKey },
        },
        RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY: {
          secretKeyRef: {
            name: readKey.secret,
            key: readKey.secretAccessKeyKey,
          },
        },
        RCLONE_CONFIG_SOURCE_ENDPOINT: garageEndpoint,
        RCLONE_CONFIG_SOURCE_REGION: "garage",
      },
    });
    server.service({ http: 8080 });
    this.vpa(server);

    return { url: `http://assets-server.${this.name}.svc:8080` };
  }
}

// an object found in a source that `find` doesn't wrap as a Workload: the target of helpers,
// like `vpa`, that take one
export class ObjectRef {
  readonly kind: string;
  readonly name: string;
  private readonly sink: (object: Obj) => void;

  constructor(obj: Obj, sink: (object: Obj) => void) {
    this.kind = obj.kind;
    this.name = obj.metadata.name;
    this.sink = sink;
  }

  get target(): VpaTarget {
    return { kind: this.kind, name: this.name };
  }

  vpa(opts?: VpaOptions): this {
    this.sink(vpa(this.target, opts));
    return this;
  }
}

const wrapFound = (
  obj: Obj,
  sink: (object: Obj) => void,
): Workload | Service | ObjectRef =>
  (workloadKinds as readonly string[]).includes(obj.kind)
    ? Workload.wrap(obj, sink)
    : obj.kind === "Service"
      ? new Service(obj, sink)
      : new ObjectRef(obj, sink);

// the objects of a `helm`, `kustomize` or `manifest` call, already added. `find` gives a handle
// to one of them (a Workload, a Service, or an ObjectRef) so helpers like `vpa` and the monitors
// can be called on it directly
export class Source {
  private readonly objects: Obj[];
  private readonly sink: (object: Obj) => void;

  constructor(objects: Obj[], sink: (object: Obj) => void) {
    this.objects = objects;
    this.sink = sink;
  }

  find(kind: WorkloadKind, name: string): Workload;
  find(kind: "Service", name: string): Service;
  find(kind: string, name: string): ObjectRef;
  find(kind: string, name: string): Workload | Service | ObjectRef {
    return wrapFound(editor(this.objects).find({ kind, name }), this.sink);
  }

  findAll(kind: WorkloadKind, name: string): Workload[];
  findAll(kind: "Service", name: string): Service[];
  findAll(kind: string, name: string): ObjectRef[];
  findAll(kind: string, name: string): (Workload | Service | ObjectRef)[] {
    return editor(this.objects)
      .findAll({ kind, name })
      .map((obj) => wrapFound(obj, this.sink));
  }
}

const build = (resource: Resource): Obj[] => {
  if (
    resource instanceof Workload ||
    resource instanceof HttpRoute ||
    resource instanceof GrpcRoute
  ) {
    return resource.objects();
  }
  return [resource];
};

// what `kubectl apply` needs of an object; `origin` is named in the error
const validate = (origin: string, objects: Obj[]): Obj[] => {
  objects.forEach((obj, i) => {
    for (const field of ["apiVersion", "kind"]) {
      if (typeof obj?.[field] !== "string") {
        throw new Error(`${origin}: object ${i} has no '${field}'`);
      }
    }
    if (typeof obj.metadata?.name !== "string") {
      throw new Error(
        `${origin}: ${obj.kind} (object ${i}) has no 'metadata.name'`,
      );
    }
  });
  return objects;
};

// drops `creationTimestamp: null` (controller-gen, in crds) and empty label and annotation maps (helm)
const tidy = (items: Obj[]): Obj[] =>
  items.map((obj) => {
    if (!obj.metadata) {
      return obj;
    }
    const metadata = { ...obj.metadata };
    if (metadata.creationTimestamp === null) {
      delete metadata.creationTimestamp;
    }
    for (const field of ["annotations", "labels"]) {
      if (metadata[field] && Object.keys(metadata[field]).length === 0) {
        delete metadata[field];
      }
    }
    return { ...obj, metadata };
  });
