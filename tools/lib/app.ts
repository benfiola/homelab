import { dirname, resolve } from "node:path";
import { crdsApp, fluxDeclaration, listApps, networkFunction } from "./apps.ts";
import { images } from "./images.ts";
import { configMap, files } from "./k8s/config.ts";
import {
  bucketSyncPolicy,
  garageBucket,
  garageKey,
  type GarageKey,
  type GarageBucketOptions,
  type GarageKeyOptions,
} from "./k8s/garage.ts";
import {
  GrpcRoute,
  HttpRoute,
  tcpRoute,
  udpRoute,
  type Gateway,
  type Target as RouteTarget,
} from "./k8s/routes.ts";
import type { FluxDeclaration } from "./k8s/flux.ts";
import { addLabels } from "./k8s/labels.ts";
import type { NetworkFunction } from "./k8s/network-policy.ts";
import { moveToNamespace } from "./k8s/namespace.ts";
import { nasVolume } from "./k8s/storage.ts";
import {
  appSecrets,
  appTemplatedSecrets,
  bucketSyncAuth,
  bucketSyncSecret,
  secretName,
  secretRef,
} from "./secrets/vault.ts";
import {
  vpa,
  type Options as VpaOptions,
  type Target as VpaTarget,
} from "./k8s/vpa.ts";
import {
  securityContext,
  Workload,
  type SecurityContextOptions,
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

export interface Selector {
  kind: string;
  name: string;
  // api group, for kinds that exist in several
  group?: string;
}

export interface SourceOptions {
  // added to every object, and to the selectors that match pods
  labels?: Record<string, string>;
}

export interface ManifestOptions extends SourceOptions {
  // moves the objects into the app's namespace, as `kubectl apply -n` would (helm takes its namespace itself)
  namespace?: boolean;
}

export interface HelmSourceOptions extends SourceOptions {
  // defaults to the chart's name
  release?: string;
  // values files, named relative to the app's directory
  values?: string | string[];
  // include the chart's crds (default true)
  crds?: boolean;
  kubeVersion?: string;
}

export type AppFunction = (h: App) => void | Obj[] | Promise<void | Obj[]>;

// the handle an app's `app.ts` receives. everything created through it is collected for the app and
// built when the app finishes, so workloads and routes keep accepting additions until then.
export class App {
  readonly app: string;
  readonly dir: string;

  // namespace stamped on objects that name none; the app's name unless set
  namespaceName: string;

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
  readonly timezone = "America/Los_Angeles";

  private readonly resources: (
    Obj | Workload | HttpRoute | GrpcRoute | Promise<Obj[]>
  )[] = [];
  private readonly edits: { selector: Selector; edit: (obj: Obj) => void }[] =
    [];

  constructor(app: string, dir: string) {
    this.app = app;
    this.dir = dir;
    this.namespaceName = app;
  }

  // restricted security contexts, the default for workloads
  securityContext(opts?: SecurityContextOptions) {
    return securityContext(opts);
  }

  // the app's namespace. `privileged` lifts pod security admission for apps that need host access
  namespace(opts: { privileged?: boolean } = {}): this {
    return this.add({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: this.namespaceName,
        ...(opts.privileged && {
          labels: { "pod-security.kubernetes.io/enforce": "privileged" },
        }),
      },
    });
  }

  add(...objects: Obj[]): this {
    this.resources.push(...objects);
    return this;
  }

  // sources fetch as soon as they are declared, and are awaited when the app finishes
  private source(objects: Promise<Obj[]>, opts: ManifestOptions = {}): this {
    const labelled = objects.then((o) => {
      const moved = opts.namespace ? moveToNamespace(o, this.namespaceName) : o;
      return opts.labels
        ? moved.map((obj) => addLabels(obj, opts.labels!))
        : moved;
    });
    // avoids an unhandled rejection before the app is awaited
    labelled.catch(() => {});
    this.resources.push(labelled);
    return this;
  }

  // the objects of a helm chart: `<repository url>/<chart>?version=<version>` (see parseChartUrl)
  helm(
    chart: string,
    { values, labels, ...opts }: HelmSourceOptions = {},
  ): this {
    const files = [values ?? []].flat().map((file) => resolve(this.dir, file));
    return this.source(
      helm(
        { ...parseChartUrl(chart), ...opts, values: files },
        this.namespaceName,
      ),
      { labels },
    );
  }

  // the objects of a manifest: a url, or a path relative to the app's directory
  manifest(source: string, opts?: ManifestOptions): this {
    return this.source(manifest(source, this.dir), opts);
  }

  // the objects of an upstream kustomize overlay (a git url)
  kustomize(url: string, opts?: ManifestOptions): this {
    return this.source(kustomize(url), opts);
  }

  // evaluates a jsonnet file of the app's directory, with its jsonnetfile.json libraries. awaited, as the app uses the data
  jsonnet(file: string): Promise<any> {
    return jsonnet(file, this.dir);
  }

  // edits the objects matching `selector`, once the app is complete; an error if none match
  edit(selector: Selector, edit: (obj: Obj) => void): this {
    this.edits.push({ selector, edit });
    return this;
  }

  private workload(kind: WorkloadKind, name: string, opts?: WorkloadOptions) {
    const workload = new Workload(kind, name, opts, (service) =>
      this.add(service),
    );
    this.resources.push(workload);
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
    this.resources.push(route);
    return route;
  }

  grpcRoute(gateway: Gateway, hostname: string, opts?: { timeout?: string }) {
    const route = new GrpcRoute(gateway, hostname, opts);
    this.resources.push(route);
    return route;
  }

  tcpRoute(
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
  ): this {
    return this.add(...tcpRoute(gateway, hostname, fromPort, to, toPort));
  }

  udpRoute(
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
  ): this {
    return this.add(...udpRoute(gateway, hostname, fromPort, to, toPort));
  }

  vpa(target: VpaTarget | { target: VpaTarget }, opts?: VpaOptions): this {
    return this.add(vpa("target" in target ? target.target : target, opts));
  }

  // the app's vault path, as a Secret named 'secrets' in its namespace
  secrets(): this {
    return this.add(...appSecrets(this.app));
  }

  // the same, with the Secret's keys built from templates
  templatedSecrets(templates: Record<string, string>): this {
    return this.add(...appTemplatedSecrets(this.app, templates));
  }

  // an env var source for a key of the app's 'secrets' Secret
  secretKey(key: string) {
    return { secretKeyRef: { name: secretName, key } };
  }

  // refers to a key of the app's vault path, inside a `templatedSecrets` template
  secretRef(key: string): string {
    return secretRef(key);
  }

  configMap(name: string, data: Record<string, string>): Obj {
    const object = configMap(name, data);
    this.add(object);
    return object;
  }

  // the contents of files in the app's directory, keyed by file name
  files(...names: string[]): Record<string, string> {
    return files(this.dir, ...names);
  }

  // a share on the nas: a PersistentVolume and its claim (mount it with `{ pvc: { name } }`)
  nasVolume(name: string): this {
    return this.add(...nasVolume(name));
  }

  // a garage access key; unless imported it is generated into a Secret named `garage-key-garage-<name>`
  garageKey(name: string, opts?: GarageKeyOptions): GarageKey {
    const key = garageKey(name, opts);
    this.add(key.object);
    return key;
  }

  // a garage bucket: `owners` own it, and `opts` grant other keys read-write or read-only access
  garageBucket(
    name: string,
    owners: GarageKey[],
    opts?: GarageBucketOptions,
  ): Obj {
    const bucket = garageBucket(name, owners, opts);
    this.add(bucket);
    return bucket;
  }

  // serves files synced from backblaze into a garage bucket named after the app (bucket, keys, sync
  // policy, and a read-only rclone server). returns the in-cluster url
  assetsServer(opts: { syncTimeout?: string } = {}): { url: string } {
    const name = `${this.app}-assets`;
    const auth = bucketSyncAuth();
    const key = garageKey(name);
    const readKey = garageKey(`${name}-read`);
    const credentials = bucketSyncSecret(auth, name);

    this.add(
      ...auth.objects,
      key.object,
      readKey.object,
      garageBucket(name, [key], { roKeys: [readKey] }),
      credentials,
      bucketSyncPolicy({
        bucket: name,
        key,
        source: `homelab-assets-698966/${this.app}`,
        credentials: credentials.metadata.name,
        syncTimeout: opts.syncTimeout,
      }),
    );

    const server = this.deployment("assets-server").addContainer("rclone", {
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
        RCLONE_CONFIG_SOURCE_ENDPOINT: "http://garage.garage.svc:3900",
        RCLONE_CONFIG_SOURCE_REGION: "garage",
      },
    });
    server.service({ http: 8080 });
    this.vpa(server);

    return { url: `http://assets-server.${this.app}.svc:8080` };
  }

  // everything the app created, in creation order, with the edits applied
  async objects(): Promise<Obj[]> {
    const objects = (
      await Promise.all(
        this.resources.map(async (r) =>
          r instanceof Promise
            ? // a copy, so edits never accumulate over repeated calls
              structuredClone(await r)
            : r instanceof Workload
              ? [r.object()]
              : r instanceof HttpRoute || r instanceof GrpcRoute
                ? r.objects()
                : [r],
        ),
      )
    ).flat();

    for (const { selector, edit } of this.edits) {
      const matches = objects.filter(
        (obj) =>
          obj.kind === selector.kind &&
          obj.metadata?.name === selector.name &&
          (selector.group === undefined ||
            String(obj.apiVersion).split("/")[0] === selector.group),
      );
      if (matches.length === 0) {
        throw new Error(
          `${this.app}: edit matched no object (${selector.kind}/${selector.name})`,
        );
      }
      matches.forEach(edit);
    }
    return objects;
  }
}
