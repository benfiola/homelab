import { compact } from "../object.ts";

type Obj = Record<string, any>;

export interface SecurityContextOptions {
  gid?: number;
  uid?: number;
  caps?: string[];
}

// restricted security contexts: non-root, no privilege escalation, no capabilities
export const securityContext = (opts: SecurityContextOptions = {}) => {
  const gid = opts.gid ?? 65534;
  const uid = opts.uid ?? 65534;
  const caps = opts.caps ?? [];
  const runAsNonRoot = uid !== 0;

  return {
    pod: {
      fsGroup: gid,
      runAsNonRoot,
      runAsUser: uid,
      runAsGroup: gid,
      seccompProfile: { type: "RuntimeDefault" },
    },
    container: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"], add: caps },
      runAsNonRoot,
      runAsUser: uid,
      runAsGroup: gid,
    },
  };
};

type Protocol = "TCP" | "UDP";

// container ports: name -> number, or [number, protocol]
export type Ports = Record<string, number | [number, Protocol]>;

// service ports: name -> port | [port, protocol] | [port, targetPort] | [port, targetPort, protocol]
//                or { targetPort, port?, protocol? }
export type ServicePorts = Record<
  string,
  | number
  | [number, Protocol]
  | [number, number]
  | [number, number, Protocol]
  | { targetPort: number; port?: number; protocol?: Protocol }
>;

export type Env = Record<
  string,
  | string
  | { secretKeyRef: { name: string; key: string; optional?: boolean } }
  | { configMapKeyRef: { name: string; key: string; optional?: boolean } }
  | { fieldRef: { fieldPath: string; apiVersion?: string } }
>;

type VolumeItem = { key: string; path?: string };

export type Volume =
  | { pvc: { size: string; storageClass: string } | { name: string } }
  | { configMap: string; items?: VolumeItem[]; defaultMode?: number }
  | { secret: string; items?: VolumeItem[]; defaultMode?: number }
  | { memory: { sizeLimit?: string } }
  | { ephemeral: { size: string } }
  | { hostPath: { path: string; type?: string } };

export type Volumes = Record<string, Volume>;

export interface Probe {
  http?: { path: string; port: number | string; scheme?: string };
  tcp?: { port: number | string };
  exec?: { command: string[] };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

export type VolumeMount =
  string | { mountPath: string; subPath?: string; readOnly?: boolean };

export interface ContainerOptions {
  image: string;
  containerPorts?: Ports;
  env?: Env;
  cmd?: string[];
  args?: string[];
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
  volumeMounts?: Record<string, VolumeMount>;
  securityContext?: SecurityContextOptions;
  readiness?: Probe;
  liveness?: Probe;
  startup?: Probe;
}

export type ProbeTarget = Pick<Probe, "http" | "tcp" | "exec">;

export interface ProbesOptions {
  // what readiness and startup check, when it differs from liveness
  ready?: ProbeTarget;
  // seconds the app has to start before liveness takes over (default 180), or false for no startup probe
  startup?: number | false;
}

export const probes = (
  target: ProbeTarget,
  opts: ProbesOptions = {},
): Pick<ContainerOptions, "readiness" | "liveness" | "startup"> => {
  const ready = opts.ready ?? target;
  return {
    readiness: { ...ready, timeoutSeconds: 5 },
    liveness: { ...target, timeoutSeconds: 5, failureThreshold: 6 },
    startup:
      opts.startup === false
        ? undefined
        : {
            ...ready,
            periodSeconds: 10,
            failureThreshold: Math.ceil((opts.startup ?? 180) / 10),
          },
  };
};

const containerPorts = (ports: Ports | undefined) =>
  ports &&
  Object.entries(ports).map(([name, v]) => {
    const [containerPort, protocol] = Array.isArray(v) ? v : [v, "TCP"];
    return { name, containerPort, protocol };
  });

const servicePort = (config: ServicePorts[string]) => {
  if (typeof config === "number") {
    return { port: config, protocol: "TCP" };
  }
  if (Array.isArray(config)) {
    if (config.length === 2) {
      const [first, second] = config;
      return typeof second === "string"
        ? { port: first, protocol: second }
        : { port: first, targetPort: second, protocol: "TCP" };
    }
    const [port, targetPort, protocol] = config;
    return { port, targetPort, protocol };
  }
  const { targetPort, port, protocol = "TCP" } = config;
  return {
    port: port ?? targetPort,
    targetPort: port ? targetPort : undefined,
    protocol,
  };
};

const env = (vars: Env | undefined) =>
  vars &&
  Object.entries(vars).map(([name, v]) =>
    typeof v === "string" ? { name, value: v } : { name, valueFrom: v },
  );

const probe = (config: Probe | undefined) => {
  if (!config) {
    return undefined;
  }
  const { http, tcp, exec, ...timing } = config;
  const result: Obj = { ...timing };
  if (http) {
    result.httpGet = http;
  } else if (tcp) {
    result.tcpSocket = tcp;
  } else if (exec) {
    result.exec = exec;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const isClaimTemplate = (
  v: Volume,
): v is { pvc: { size: string; storageClass: string } } =>
  "pvc" in v && "size" in v.pvc;

const items = (list: VolumeItem[] | undefined) =>
  list?.map((i) => ({ key: i.key, path: i.path ?? i.key }));

const inlineVolume = (name: string, v: Volume): Obj => {
  if ("configMap" in v) {
    return {
      name,
      configMap: {
        name: v.configMap,
        items: items(v.items),
        ...(v.defaultMode !== undefined && { defaultMode: v.defaultMode }),
      },
    };
  }
  if ("secret" in v) {
    return {
      name,
      secret: {
        secretName: v.secret,
        items: items(v.items),
        ...(v.defaultMode !== undefined && { defaultMode: v.defaultMode }),
      },
    };
  }
  if ("pvc" in v) {
    return {
      name,
      persistentVolumeClaim: { claimName: (v.pvc as { name: string }).name },
    };
  }
  if ("hostPath" in v) {
    return { name, hostPath: v.hostPath };
  }
  if ("ephemeral" in v) {
    return {
      name,
      ephemeral: {
        volumeClaimTemplate: {
          spec: {
            accessModes: ["ReadWriteOnce"],
            storageClassName: "standard",
            resources: { requests: { storage: v.ephemeral.size } },
          },
        },
      },
    };
  }
  return {
    name,
    emptyDir: { medium: "Memory", sizeLimit: v.memory.sizeLimit },
  };
};

export interface WorkloadOptions {
  volumes?: Volumes;
  hostNetwork?: boolean;
  nodeSelector?: Record<string, string>;
  securityContext?: SecurityContextOptions;
  podAnnotations?: Record<string, string>;
  dnsConfig?: { ndots?: number };
  // deployments only
  replicas?: number;
}

export type WorkloadKind = "StatefulSet" | "Deployment" | "DaemonSet";

// a StatefulSet, Deployment or DaemonSet, with the restricted security contexts by default
export class Workload {
  readonly kind: WorkloadKind;
  readonly name: string;
  private readonly opts: WorkloadOptions;
  private readonly selector: Record<string, string>;
  private readonly containers: Obj[] = [];
  private readonly initContainers: Obj[] = [];
  private readonly volumes: Obj[];
  private readonly volumeNames: Set<string>;
  private readonly sink?: (object: Obj) => void;

  // `sink` receives the Service created by `service()`
  constructor(
    kind: WorkloadKind,
    name: string,
    opts: WorkloadOptions = {},
    sink?: (object: Obj) => void,
  ) {
    const claims = Object.entries(opts.volumes ?? {}).filter(([, v]) =>
      isClaimTemplate(v),
    );
    if (kind !== "StatefulSet" && claims.length > 0) {
      throw new Error(
        `${kind} does not support PVC templates (${claims.map(([n]) => n).join(", ")}). Use a StatefulSet for per-replica storage, or reference an existing PVC with { pvc: { name } }.`,
      );
    }
    this.kind = kind;
    this.name = name;
    this.opts = opts;
    this.sink = sink;
    this.selector = { "app.kubernetes.io/name": name };
    this.volumeNames = new Set(Object.keys(opts.volumes ?? {}));
    this.volumes = Object.entries(opts.volumes ?? {})
      .filter(([, v]) => !isClaimTemplate(v))
      .map(([n, v]) => inlineVolume(n, v));
  }

  private container(name: string, opts: ContainerOptions) {
    const { container } = securityContext({
      ...this.opts.securityContext,
      ...opts.securityContext,
    });
    return {
      name,
      image: opts.image,
      command: opts.cmd,
      args: opts.args,
      env: env(opts.env),
      ports: containerPorts(opts.containerPorts),
      resources: opts.resources,
      securityContext: container,
      volumeMounts:
        opts.volumeMounts &&
        Object.entries(opts.volumeMounts).map(([n, mount]) => {
          const { mountPath, subPath, readOnly } =
            typeof mount === "string" ? { mountPath: mount } : mount;
          return { name: n, mountPath, subPath, readOnly };
        }),
      readinessProbe: probe(opts.readiness),
      livenessProbe: probe(opts.liveness),
      startupProbe: probe(opts.startup),
    };
  }

  addContainer(name: string, opts: ContainerOptions): this {
    this.containers.push(this.container(name, opts));
    return this;
  }

  addInitContainer(name: string, opts: ContainerOptions): this {
    this.initContainers.push(this.container(name, opts));
    return this;
  }

  addVolume(name: string, volume: Volume): this {
    if (this.volumeNames.has(name)) {
      throw new Error(`Volume "${name}" is already defined on this workload.`);
    }
    if (isClaimTemplate(volume)) {
      throw new Error(
        `addVolume does not support PVC templates (${name}). Declare it in the workload's volumes instead.`,
      );
    }
    this.volumes.push(inlineVolume(name, volume));
    this.volumeNames.add(name);
    return this;
  }

  service(
    ports: ServicePorts,
  ): Obj & { kind: string; metadata: { name: string } } {
    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: this.name },
      spec: {
        selector: this.selector,
        ports: Object.entries(ports).map(([name, config]) =>
          compact({ name, ...servicePort(config) }),
        ),
      },
    };
    this.sink?.(service);
    return service;
  }

  // what routes and autoscalers point at
  get target() {
    return { kind: this.kind, name: this.name };
  }

  object(): Obj {
    const { opts } = this;
    const sec = securityContext(opts.securityContext);
    const podSpec = {
      hostNetwork: opts.hostNetwork,
      nodeSelector: opts.nodeSelector,
      securityContext: sec.pod,
      dnsConfig: opts.dnsConfig?.ndots
        ? { options: [{ name: "ndots", value: String(opts.dnsConfig.ndots) }] }
        : undefined,
      volumes: this.volumes,
      initContainers: this.initContainers,
      containers: this.containers,
    };

    const claimTemplates = Object.entries(opts.volumes ?? {})
      .filter(
        (
          entry,
        ): entry is [string, { pvc: { size: string; storageClass: string } }] =>
          isClaimTemplate(entry[1]),
      )
      .map(([name, { pvc }]) => ({
        metadata: { name },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: pvc.size } },
          storageClassName: pvc.storageClass,
        },
      }));

    // deployments don't annotate their pods; stateful sets and daemon sets do
    const template =
      this.kind === "Deployment"
        ? { metadata: { labels: this.selector }, spec: podSpec }
        : {
            metadata: {
              labels: this.selector,
              annotations: opts.podAnnotations,
            },
            spec: podSpec,
          };

    return compact({
      apiVersion: "apps/v1",
      kind: this.kind,
      metadata: { name: this.name },
      spec: {
        replicas: this.kind === "Deployment" ? (opts.replicas ?? 1) : undefined,
        selector: { matchLabels: this.selector },
        template,
        volumeClaimTemplates:
          claimTemplates.length > 0 ? claimTemplates : undefined,
      },
    });
  }
}

const vpaWorkloads = ["Deployment", "StatefulSet", "DaemonSet"];

export interface VpaTarget {
  kind: string;
  name: string;
  // required for targets that aren't a Deployment, StatefulSet or DaemonSet
  apiVersion?: string;
}

export interface VpaOptions {
  // recommend only: never evict or resize
  advisory?: boolean;
  namespace?: string;
}

// a VerticalPodAutoscaler for a workload, resizing pods in place where it can
export const vpa = (target: VpaTarget, opts: VpaOptions = {}): Obj => {
  const apiVersion = vpaWorkloads.includes(target.kind)
    ? "apps/v1"
    : target.apiVersion;
  return {
    apiVersion: "autoscaling.k8s.io/v1",
    kind: "VerticalPodAutoscaler",
    metadata: {
      name: target.name,
      ...(opts.namespace && { namespace: opts.namespace }),
    },
    spec: {
      targetRef: { apiVersion, kind: target.kind, name: target.name },
      updatePolicy: { updateMode: opts.advisory ? "Off" : "InPlaceOrRecreate" },
    },
  };
};
