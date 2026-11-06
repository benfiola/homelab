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
  pushStore,
  secretKeys,
  secretRef,
  type SecretKeys,
  type SecretOptions,
} from "./k8s/secrets.ts";
import { nasVolume } from "./k8s/storage.ts";
import { volsyncBackup, type VolsyncBackupOptions } from "./k8s/volsync.ts";
import {
  securityContext,
  vpa,
  Workload,
  type SecurityContextOptions,
  type VpaOptions,
  type VpaTarget,
  type WorkloadKind,
  type WorkloadOptions,
} from "./k8s/workload.ts";
import { helm, parseChartUrl } from "./sources/helm.ts";
import { jsonnet } from "./sources/jsonnet.ts";
import { kustomize } from "./sources/kustomize.ts";
import { manifest } from "./sources/manifest.ts";

type Obj = Record<string, any>;

// the type of an app's exported `app`; it types `h`
export type { Env, Workload } from "./k8s/workload.ts";

export interface KustomizeSourceOptions {
  // the namespace the objects move to, with what refers to them (default: the app's)
  namespace?: string;
  // added to every object, and to the selectors and pod templates that match them
  labels?: Record<string, string>;
}

export interface HelmSourceOptions {
  // the namespace to render the chart for (default: the app's)
  namespace?: string;
  // defaults to the chart's name
  release?: string;
  values?: Obj;
  // include the chart's crds (default true)
  crds?: boolean;
  kubeVersion?: string;
}

export type AppFunction = (h: App) => void | Obj[] | Promise<void | Obj[]>;

// workloads, and the namespace to put them (and their services) in, if not the app's
export type AppWorkloadOptions = WorkloadOptions & { namespace?: string };

type Resource = Obj | Workload | HttpRoute | GrpcRoute | Promise<Obj[]>;

// the handle an app's `app.ts` receives. everything created through it is collected for the app and
// built when the app finishes, so workloads and routes keep accepting additions until then.
export class App {
  readonly app: string;
  readonly dir: string;

  // the namespace of what names none: the app's name unless set. read as things are added, so it
  // can only be set before the first
  private _namespaceName: string;
  get namespaceName(): string {
    return this._namespaceName;
  }
  set namespaceName(name: string) {
    if (this.resources.length > 0) {
      throw new Error(
        `${this.app}: namespaceName is set after something was added (which used ${this._namespaceName}): set it first`,
      );
    }
    this._namespaceName = name;
  }

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
    this._namespaceName = app;
  }

  // restricted security contexts, the default for workloads
  securityContext(opts?: SecurityContextOptions) {
    return securityContext(opts);
  }

  // the app's namespace, or another by `name`. `privileged` lifts pod security admission for apps
  // that need host access
  namespace(opts: { name?: string; privileged?: boolean } = {}): this {
    return this.add({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: opts.name ?? this.namespaceName,
        ...(opts.privileged && {
          labels: { "pod-security.kubernetes.io/enforce": "privileged" },
        }),
      },
    });
  }

  add(...objects: Obj[]): this {
    objects.forEach((object) => this.track(object));
    return this;
  }

  // queues something to build when the app finishes, in `namespace` where it names none. that is
  // fixed now, as namespaceName can't change once something is queued
  private track(resource: Resource, namespace = this.namespaceName): void {
    this.resources.push({ resource, namespace });
  }

  // sources fetch as soon as they are declared, and are awaited when the app finishes
  private source(objects: Promise<Obj[]>, namespace?: string): this {
    // avoids an unhandled rejection before the app is awaited
    objects.catch(() => {});
    this.track(objects, namespace);
    return this;
  }

  // the objects of a helm chart: `<repository url>/<chart>?version=<version>` (see parseChartUrl)
  helm(chart: string, { namespace, ...opts }: HelmSourceOptions = {}): this {
    const objects = helm(
      { ...parseChartUrl(chart), ...opts },
      namespace ?? this.namespaceName,
    );
    // objects the chart leaves without a namespace are given the one it was rendered for
    return this.source(objects, namespace);
  }

  // the objects of a manifest: a url, or a path relative to the app's directory
  manifest(source: string): this {
    return this.source(manifest(source, this.dir));
  }

  // the objects of an upstream kustomize overlay (a git url), or of a manifest at a url that needs
  // changing
  kustomize(source: string, opts: KustomizeSourceOptions = {}): this {
    return this.source(
      kustomize(source, {
        namespace: opts.namespace ?? this.namespaceName,
        labels: opts.labels,
      }),
    );
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

  private workload(
    kind: WorkloadKind,
    name: string,
    { namespace, ...opts }: AppWorkloadOptions = {},
  ) {
    const workload = new Workload(kind, name, opts, (service) =>
      this.track(service, namespace),
    );
    this.track(workload, namespace);
    return workload;
  }

  statefulSet(name: string, opts?: AppWorkloadOptions) {
    return this.workload("StatefulSet", name, opts);
  }

  deployment(name: string, opts?: AppWorkloadOptions) {
    return this.workload("Deployment", name, opts);
  }

  daemonSet(name: string, opts?: AppWorkloadOptions) {
    return this.workload("DaemonSet", name, opts);
  }

  // an https route (with its listener); add where it sends traffic with `.match()`
  httpRoute(gateway: Gateway, hostname: string, opts?: { namespace?: string }) {
    const route = new HttpRoute(gateway, hostname);
    this.track(route, opts?.namespace);
    return route;
  }

  grpcRoute(
    gateway: Gateway,
    hostname: string,
    { namespace, ...opts }: { timeout?: string; namespace?: string } = {},
  ) {
    const route = new GrpcRoute(gateway, hostname, opts);
    this.track(route, namespace);
    return route;
  }

  tcpRoute(
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
    opts: { namespace?: string } = {},
  ): this {
    tcpRoute(gateway, hostname, fromPort, to, toPort).forEach((object) =>
      this.track(object, opts.namespace),
    );
    return this;
  }

  udpRoute(
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
    opts: { namespace?: string } = {},
  ): this {
    udpRoute(gateway, hostname, fromPort, to, toPort).forEach((object) =>
      this.track(object, opts.namespace),
    );
    return this;
  }

  vpa(target: VpaTarget | { target: VpaTarget }, opts?: VpaOptions): this {
    return this.add(vpa("target" in target ? target.target : target, opts));
  }

  // a Secret holding keys of the app's section of the `apps` secret, and the handle to read its
  // keys through. `namespace` and `from` (another app's section) override the defaults
  secrets<K extends string>(
    name: string,
    keys: readonly K[],
    opts: SecretOptions = {},
  ): SecretKeys<K> {
    const namespace = opts.namespace ?? this.namespaceName;
    this.push(
      namespace,
      appSecrets(this.app, name, keys, { ...opts, namespace }),
    );
    return secretKeys(name, keys);
  }

  // the same, with the Secret's keys built from templates
  templatedSecrets<K extends string>(
    name: string,
    templates: Record<K, string>,
    opts: Pick<SecretOptions, "namespace"> = {},
  ): SecretKeys<K> {
    const namespace = opts.namespace ?? this.namespaceName;
    this.push(
      namespace,
      appTemplatedSecrets(this.app, name, templates, { namespace }),
    );
    return secretKeys(name, Object.keys(templates) as K[]);
  }

  // refers to a key of the app's secrets, inside a `templatedSecrets` template
  secretRef(key: string): string {
    return secretRef(key, this.app);
  }

  // the objects that push Secrets into a namespace, and the store they push through (one per namespace)
  private push(namespace: string, objects: Obj[]): this {
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
      this.add(pushStore(namespace));
    }
    return this.add(...objects);
  }

  configMap(
    name: string,
    data: Record<string, string>,
    opts: { namespace?: string } = {},
  ): Obj {
    const object = {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name },
      data,
    };
    this.track(object, opts.namespace);
    return object;
  }

  // the contents of files in the app's directory, keyed by file name
  files(...names: string[]): Record<string, string> {
    return Object.fromEntries(
      names.map((name) => [name, readFileSync(join(this.dir, name), "utf-8")]),
    );
  }

  // a share on the nas: a PersistentVolume and its claim (mount it with `{ pvc: { name } }`)
  nasVolume(name: string, opts: { namespace?: string } = {}): this {
    nasVolume(name).forEach((object) => this.track(object, opts.namespace));
    return this;
  }

  // backs up a PVC of the app (or of `namespace`) to backblaze, with the credentials in volsync's
  // section of the `apps` file
  volumeBackup(
    pvc: string,
    opts: VolsyncBackupOptions & { namespace?: string } = {},
  ): this {
    const namespace = opts.namespace ?? this.namespaceName;
    const { secret, source } = volsyncBackup(pvc, namespace, opts);
    this.push(
      namespace,
      appTemplatedSecrets(this.app, secret.name, secret.templates, {
        namespace,
      }),
    );
    this.track(source, opts.namespace);
    return this;
  }

  // a garage access key; unless imported it is generated into a Secret named `garage-key-garage-<name>`
  garageKey(
    name: string,
    { namespace, ...opts }: GarageKeyOptions & { namespace?: string } = {},
  ): GarageKey {
    const key = garageKey(name, opts);
    this.track(key.object, namespace);
    this.grantGarage(namespace ?? this.namespaceName, key.object.kind);
    return key;
  }

  // a garage bucket: `owners` own it, and `opts` grant other keys read-write or read-only access
  garageBucket(
    name: string,
    owners: GarageKey[],
    { namespace, ...opts }: GarageBucketOptions & { namespace?: string } = {},
  ): Obj {
    const bucket = garageBucket(name, owners, opts);
    this.track(bucket, namespace);
    this.grantGarage(namespace ?? this.namespaceName, bucket.kind);
    return bucket;
  }

  // lets a namespace's garage resources of `kind` reference the cluster: one grant per namespace,
  // widened as kinds are added to it. named for the app too, so apps sharing a namespace don't share a grant
  private grantGarage(namespace: string, kind: string): void {
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

  // serves files synced from backblaze into a garage bucket named after the app (bucket, keys, sync
  // policy, and a read-only rclone server). returns the in-cluster url
  assetsServer(opts: { syncTimeout?: string; namespace?: string } = {}): {
    url: string;
  } {
    const namespace = opts.namespace ?? this.namespaceName;
    const name = `${this.app}-assets`;
    const key = garageKey(name);
    const readKey = garageKey(`${name}-read`);
    const bucket = garageBucket(name, [key], { roKeys: [readKey] });
    [key.object, readKey.object, bucket].forEach((o) =>
      this.grantGarage(namespace, o.kind),
    );
    const credentials = `bucket-sync-${name}`;

    const objects = [
      key.object,
      readKey.object,
      bucket,
      bucketSyncPolicy({
        bucket: name,
        key,
        source: `homelab-assets-698966/${this.app}`,
        credentials,
        syncTimeout: opts.syncTimeout,
      }),
    ];
    objects.forEach((object) => this.track(object, opts.namespace));
    // bucket-sync's backblaze credentials are in a section of their own
    this.push(
      namespace,
      appSecrets(this.app, credentials, bucketSyncKeys, {
        namespace,
        from: "bucket-sync",
      }),
    );

    const server = this.deployment("assets-server", {
      namespace: opts.namespace,
    }).addContainer("rclone", {
      image: this.images.rclone,
      containerPorts: { http: 8080 },
      args: ["serve", "http", `source:${name}`, "--addr=:8080"],
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
    this.vpa(server, { namespace: opts.namespace });

    return { url: `http://assets-server.${namespace}.svc:8080` };
  }

  // what the app publishes: everything it created, in creation order, after the post-render hooks
  async objects(): Promise<Obj[]> {
    const objects = (
      await Promise.all(
        this.resources.map(async ({ resource, namespace }) => {
          const built = await build(resource);
          // a copy, so that hooks never change what was added, or accumulate over repeated calls
          return stampNamespace(structuredClone(built), namespace);
        }),
      )
    ).flat();

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

const build = async (resource: Resource): Promise<Obj[]> => {
  if (resource instanceof Promise) {
    return resource;
  }
  if (resource instanceof Workload) {
    return [resource.object()];
  }
  if (resource instanceof HttpRoute || resource instanceof GrpcRoute) {
    return resource.objects();
  }
  return [resource];
};

// flux applies a namespace-less object to 'default', and identifies every object, cluster-scoped ones
// included, as <namespace>_<name>_<group>_<kind>. so every object is stamped (kubernetes ignores the
// namespace on cluster-scoped kinds): changing a stamp changes the id, and flux prunes the object.
const stampNamespace = (items: Obj[], namespace: string): Obj[] =>
  items.map((obj) =>
    obj?.metadata?.namespace
      ? obj
      : { ...obj, metadata: { ...obj?.metadata, namespace } },
  );

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
