import {
  ApiObject,
  Chart as BaseChart,
  Helm as BaseHelm,
  Include,
} from "cdk8s";
import { Construct } from "constructs";
import { writeFile } from "fs/promises";
import { get } from "lodash";
import { BucketSyncPolicy as BaseBucketSyncPolicy } from "../assets/bucket-sync/bucket-sync.homelab-images.benfiola.com";
import {
  GarageBucket as BaseGarageBucket,
  GarageKey as BaseGarageKey,
  GarageKeySpecImportKey as GarageImportKey,
  GarageKeySpecSecretTemplate as GarageSecretTemplate,
} from "../assets/garage-operator/garage.rajsingh.info";
import {
  HttpRoute as BaseHttpRoute,
  TcpRoute as BaseTcpRoute,
  UdpRoute as BaseUdpRoute,
} from "../assets/gateway-api/gateway.networking.k8s.io";
import {
  DaemonSet as BaseDaemonSet,
  Deployment as BaseDeployment,
  Namespace as BaseNamespace,
  StatefulSet as BaseStatefulSet,
  Service,
  ServiceAccount,
} from "../assets/kubernetes/k8s";
import {
  VaultAuth as BaseVaultAuth,
  VaultDynamicSecret as BaseVaultDynamicSecret,
  VaultStaticSecret as BaseVaultStaticSecret,
  VaultAuthSpecMethod as VaultAuthMethod,
  VaultDynamicSecretSpecDestinationTransformationTemplates as VaultSecretTemplate,
  VaultStaticSecretSpecType as VaultSecretType,
} from "../assets/vault-secrets-operator/secrets.hashicorp.com";
import {
  VerticalPodAutoscaler as BaseVerticalPodAutoscaler,
  VerticalPodAutoscalerSpecUpdatePolicyUpdateMode as UpdateMode,
} from "../assets/vertical-pod-autoscaler/autoscaling.k8s.io";
import { ReplicationSource } from "../assets/volsync/volsync.backube";
import { kustomize } from "./kubernetes";
import { getTempy } from "./tempy";

const defaultGid = 65534;
const defaultUid = 65534;

export type KustomizationOpts =
  | { url: string; dynamic?: never }
  | { dynamic: Record<string, any>; url?: never };

export class Kustomization extends Include {
  static init = async (
    scope: Construct,
    id: string,
    opts: KustomizationOpts,
  ) => {
    const tempy = await getTempy();

    return await tempy.temporaryFileTask(async (file: string) => {
      const content = await kustomize(opts);
      await writeFile(file, content);

      return new Kustomization(scope, id, { url: file });
    });
  };
}

const vpaKnownKinds = ["Deployment", "StatefulSet", "DaemonSet"] as const;

type VPAKnownKind = (typeof vpaKnownKinds)[number];

interface VPAKnownTarget {
  kind: VPAKnownKind;
  name: string;
}

interface VPAUnknownTarget {
  apiVersion: string;
  kind: string;
  name: string;
}

type VPATarget = VPAKnownTarget | VPAUnknownTarget;

const isVpaKnownTarget = (target: VPATarget): target is VPAKnownTarget => {
  return vpaKnownKinds.includes(target.kind as any);
};

interface VPAOpts {
  advisory?: boolean;
  namespace?: string;
}

export class VerticalPodAutoscaler extends BaseVerticalPodAutoscaler {
  constructor(construct: Construct, target: VPATarget, opts: VPAOpts = {}) {
    const id = `${construct.node.id}-vertical-pod-autoscaler-${target.name}`;

    const targetRef = {
      apiVersion: isVpaKnownTarget(target) ? "apps/v1" : target.apiVersion,
      kind: target.kind,
      name: target.name,
    };

    const updateMode = opts.advisory
      ? UpdateMode.OFF
      : UpdateMode.IN_PLACE_OR_RECREATE;

    super(construct, id, {
      metadata: {
        name: target.name,
        namespace: opts.namespace,
      },
      spec: {
        targetRef,
        updatePolicy: {
          updateMode,
        },
      },
    });
  }
}

interface FindTarget {
  apiVersion: string;
  kind: string;
  name: string;
}

export const findApiObject = (obj: Construct, target: FindTarget) => {
  const children = obj.node.findAll();
  for (const child of children) {
    if (!ApiObject.isApiObject(child)) {
      continue;
    }
    if (
      child.apiVersion !== target.apiVersion ||
      child.kind !== target.kind ||
      child.name !== target.name
    ) {
      continue;
    }
    return child;
  }
  throw new Error(
    `could not find object: ${target.apiVersion}/${target.kind}/${target.name}`,
  );
};

export const getField = (obj: ApiObject, field: string) => {
  const data = obj.toJson();
  const value = get(data, field);
  if (value === undefined) {
    throw new Error(
      `undefined field ${field} for object ${obj.kind}/${obj.name}`,
    );
  }
  return value;
};

interface ChartOpts {
  namespace?: string;
}

export class Chart extends BaseChart {
  constructor(construct: Construct, id: string, opts: ChartOpts = {}) {
    const namespace = opts.namespace ?? id;

    super(construct, id, {
      disableResourceNameHashes: true,
      namespace,
    });
  }
}

interface NamespaceOpts {
  privileged?: boolean;
}

export class Namespace extends BaseNamespace {
  constructor(chart: BaseChart, opts: NamespaceOpts = {}) {
    if (chart.namespace === undefined) {
      throw new Error(`chart namespace undefined`);
    }

    const labels: Record<string, string> = {};
    if (opts.privileged) {
      labels["pod-security.kubernetes.io/enforce"] = "privileged";
    }

    super(chart, `${chart.node.id}-namespace`, {
      metadata: {
        name: chart.namespace,
        labels,
      },
    });
  }
}

interface VaultAuthOpts {
  role?: string;
  serviceAccount?: string;
}

export class VaultAuth extends Construct {
  readonly name: string;

  constructor(construct: Construct, opts: VaultAuthOpts = {}) {
    const role = opts.role ?? construct.node.id;
    const serviceAccountName = opts.serviceAccount ?? "vault-secrets-operator";

    const id = `${construct.node.id}-vault-auth-${serviceAccountName}`;
    super(construct, id);

    const serviceAccount = new ServiceAccount(this, `${id}-service-account`, {
      metadata: {
        name: serviceAccountName,
      },
    });

    const auth = new BaseVaultAuth(this, `${id}-vault-auth`, {
      metadata: {
        name: role,
      },
      spec: {
        kubernetes: {
          role,
          serviceAccount: serviceAccount.name,
        },
        method: VaultAuthMethod.KUBERNETES,
        mount: "kubernetes",
      },
    });

    this.name = auth.name;
  }
}

interface VaultStaticSecretOpts {
  name?: string;
  path?: string;
}

export class VaultStaticSecret extends Construct {
  readonly name: string;

  constructor(
    construct: Construct,
    auth: VaultAuth,
    opts: VaultStaticSecretOpts = {},
  ) {
    const name = opts.name ?? "secrets";
    const path = opts.path ?? construct.node.id;

    const id = `${construct.node.id}-vault-static-secret-${name}`;
    super(construct, id);

    const secret = new BaseVaultStaticSecret(
      this,
      `${id}-vault-static-secret-${name}`,
      {
        metadata: {
          name,
        },
        spec: {
          destination: {
            create: true,
            name,
          },
          path,
          mount: "secrets",
          type: VaultSecretType.KV_HYPHEN_V2,
          vaultAuthRef: auth.name,
        },
      },
    );

    this.name = getField(secret, "spec.destination.name");
  }
}

interface VaultDynamicSecretOpts {
  name?: string;
  path?: string;
}

export class VaultDynamicSecret extends Construct {
  readonly name: string;

  constructor(
    construct: Construct,
    auth: VaultAuth,
    templatesFn: (
      secretRefFn: (secret: string) => string,
    ) => Record<string, string>,
    opts: VaultDynamicSecretOpts = {},
  ) {
    const name = opts.name ?? "secrets";
    const path = opts.path ?? construct.node.id;

    const id = `${construct.node.id}-vault-dynamic-secret-${name}`;
    super(construct, id);

    const secretRefFn = (secret: string) =>
      `{{ get (get .Secrets "data") "${secret}" }}`;
    const templates = templatesFn(secretRefFn);

    const specTemplates: Record<string, VaultSecretTemplate> = {};
    for (const key of Object.keys(templates)) {
      specTemplates[key] = {
        text: templates[key],
      };
    }

    const secret = new BaseVaultDynamicSecret(
      construct,
      `${id}-vault-static-secret`,
      {
        metadata: {
          name,
        },
        spec: {
          destination: {
            create: true,
            name,
            transformation: {
              templates: specTemplates,
            },
          },
          path: `data/${path}`,
          mount: "secrets",
          vaultAuthRef: auth.name,
        },
      },
    );

    this.name = getField(secret, "spec.destination.name");
  }
}

interface HelmOpts {
  releaseName?: string;
  skipCRDs?: boolean;
}

export class Helm extends BaseHelm {
  constructor(
    construct: BaseChart,
    id: string,
    chart: string,
    valuesAndOpts: HelmOpts | Record<string, any> = {},
  ) {
    const { releaseName: optsReleaseName, skipCRDs, ...values } = valuesAndOpts;

    const helmFlags = ["--kube-version=1.34.0", "--skip-tests"];
    if (!skipCRDs) {
      helmFlags.push("--include-crds");
    }

    const releaseName = optsReleaseName
      ? `${construct.node.id}-${optsReleaseName}`
      : construct.node.id;

    super(construct, id, {
      chart,
      helmFlags,
      namespace: construct.namespace,
      releaseName,
      values,
    });
  }
}

export const gateways = [
  "public",
  "family",
  "personal",
  "infrastructure",
  "iot",
  "friends",
] as const;
export type Gateway = (typeof gateways)[number];

const knownAnnotations = {
  useMikrotik: "homelab.benfiola.com/use-external-dns-mikrotik",
  useCloudflare: "homelab.benfiola.com/use-external-dns-cloudflare",
  hostname: "external-dns.alpha.kubernetes.io/hostname",
} as const;
type Annotations = typeof knownAnnotations;
type Annotation = Annotations[keyof Annotations];

const gatewayAnnotations: Record<Gateway, Annotation> = {
  family: knownAnnotations.useMikrotik,
  personal: knownAnnotations.useMikrotik,
  infrastructure: knownAnnotations.useMikrotik,
  public: knownAnnotations.useCloudflare,
  iot: knownAnnotations.useMikrotik,
  friends: knownAnnotations.useMikrotik,
};

interface RouteTarget {
  apiVersion?: string;
  kind: string;
  name: string;
}

export class HttpRoute extends BaseHttpRoute {
  constructor(construct: Construct, gateway: Gateway, hostname: string) {
    const id = `${construct}-http-route-${hostname}`;

    const annotations: Record<string, string> = {
      [`${gatewayAnnotations[gateway]}`]: "",
    };

    super(construct, id, {
      metadata: {
        name: hostname,
        annotations,
      },
      spec: {
        hostnames: [hostname],
        parentRefs: [
          {
            name: gateway,
            namespace: "gateway",
            sectionName: hostname,
          },
        ],
      },
    });
  }

  match(to: RouteTarget, port: number, path: string = "/") {
    const props = (this as any).props;
    const spec = (props.spec = props.spec ?? {});
    const rules = (spec.rules = spec.rules ?? []);
    rules.push({
      backendRefs: [
        {
          apiVersion: to.apiVersion,
          kind: to.kind,
          name: to.name,
          port,
        },
      ],
      matches: [{ path: { type: "PathPrefix", value: path } }],
    });
    return this;
  }
}

export class TcpRoute extends BaseTcpRoute {
  constructor(
    construct: Construct,
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
  ) {
    const name = `${hostname}-${fromPort}`;
    const id = `${construct}-tcp-route-${name}`;

    const annotations: Record<string, string> = {
      [`${knownAnnotations.hostname}`]: hostname,
      [`${gatewayAnnotations[gateway]}`]: "",
    };

    super(construct, id, {
      metadata: {
        name,
        annotations,
      },
      spec: {
        parentRefs: [
          {
            name: gateway,
            namespace: "gateway",
            sectionName: `${hostname}-tcp-${fromPort}`,
            port: fromPort,
          },
        ],
        rules: [
          {
            backendRefs: [
              {
                kind: to.kind,
                name: to.name,
                port: toPort,
              },
            ],
          },
        ],
      },
    });
  }
}

export class UdpRoute extends BaseUdpRoute {
  constructor(
    construct: Construct,
    gateway: Gateway,
    hostname: string,
    fromPort: number,
    to: RouteTarget,
    toPort: number,
  ) {
    const name = `${hostname}-${fromPort}`;
    const id = `${construct}-udp-route-${name}`;

    const annotations: Record<string, string> = {
      [`${knownAnnotations.hostname}`]: hostname,
      [`${gatewayAnnotations[gateway]}`]: "",
    };

    super(construct, id, {
      metadata: {
        name,
        annotations,
      },
      spec: {
        parentRefs: [
          {
            name: gateway,
            namespace: "gateway",
            sectionName: `${hostname}-udp-${fromPort}`,
            port: fromPort,
          },
        ],
        rules: [
          {
            backendRefs: [
              {
                kind: to.kind,
                name: to.name,
                port: toPort,
              },
            ],
          },
        ],
      },
    });
  }
}

interface GetSecurityContextOpts {
  gid?: number;
  uid?: number;
  caps?: string[];
}

export const getSecurityContext = (opts: GetSecurityContextOpts = {}) => {
  const gid = opts.gid !== undefined ? opts.gid : defaultGid;
  const uid = opts.uid !== undefined ? opts.uid : defaultUid;
  const caps = opts.caps ?? [];

  const runAsNonRoot = uid !== 0;

  const pod = {
    fsGroup: gid,
    runAsNonRoot,
    runAsUser: uid,
    runAsGroup: gid,
    seccompProfile: {
      type: "RuntimeDefault",
    },
  } as const;

  const container = {
    allowPrivilegeEscalation: false,
    capabilities: {
      drop: ["ALL"] as string[],
      add: caps,
    },
    runAsNonRoot,
    runAsUser: uid,
    runAsGroup: gid,
  } as const;

  return { pod, container };
};

type PodSecurityContext = ReturnType<typeof getSecurityContext>["pod"];

export class VolsyncAuth extends VaultAuth {
  constructor(construct: Construct) {
    super(construct, {
      role: "volsync-mover",
      serviceAccount: "volsync-mover-vault-secrets-operator",
    });
  }
}

interface VolsyncBackupOpts {
  securityContext?: PodSecurityContext;
}

export class VolsyncBackup extends Construct {
  constructor(
    chart: Chart,
    auth: VolsyncAuth,
    pvc: string,
    opts: VolsyncBackupOpts = {},
  ) {
    const id = `${chart.node.id}-volsync-backup-${pvc}`;
    super(chart, id);

    const namespace = chart.namespace;
    const vaultSecret = new VaultDynamicSecret(
      chart,
      auth,
      (secretRef) => ({
        GOOGLE_PROJECT_ID: "998272529872",
        GOOGLE_APPLICATION_CREDENTIALS: secretRef(
          "google-cloud-credentials-file",
        ),
        RESTIC_REPOSITORY: `gs:homelab-volsync-697438:/${namespace}/${pvc}`,
        RESTIC_PASSWORD: secretRef("restic-password"),
      }),
      {
        name: `volsync-mover-${pvc}`,
        path: "volsync",
      },
    );

    new ReplicationSource(chart, `replications-source-${pvc}`, {
      metadata: { name: pvc },
      spec: {
        restic: {
          copyMethod: "Clone" as any,
          moverPodLabels: {
            "app.kubernetes.io/name": "volsync-mover",
          },
          moverSecurityContext: opts.securityContext,
          pruneIntervalDays: 1,
          repository: vaultSecret.name,
          retain: {
            daily: 7,
            within: "1d",
          },
          storageClassName: "standard",
        },
        sourcePvc: pvc,
        trigger: {
          schedule: "0 12 * * *",
        },
      },
    });
  }
}

const garageClusterNames = ["garage"] as const;

export type GarageClusterName = (typeof garageClusterNames)[number];

interface GarageKeyOpts {
  existingSecret?: {
    accessKeyId: string;
    secretAccessKey: string;
    name: string;
  };
}

export class GarageKey extends Construct {
  readonly name: string;
  readonly secret: string;
  readonly accessKeyIdKey: string;
  readonly secretAccessKeyKey: string;

  constructor(
    chart: Chart,
    clusterName: GarageClusterName,
    name: string,
    opts: GarageKeyOpts = {},
  ) {
    const id = `${chart.node.id}-garage-key-${clusterName}-${name}`;
    super(chart, id);

    let importKey: GarageImportKey | undefined = undefined;
    let secretTemplate: GarageSecretTemplate | undefined = undefined;
    if (opts.existingSecret) {
      this.secret = opts.existingSecret.name;
      this.accessKeyIdKey = opts.existingSecret.accessKeyId;
      this.secretAccessKeyKey = opts.existingSecret.secretAccessKey;
      importKey = {
        secretRef: {
          name: this.secret,
          namespace: chart.namespace,
        },
        accessKeyId: this.accessKeyIdKey,
        secretAccessKey: this.secretAccessKeyKey,
      };
    } else {
      this.secret = `garage-key-${clusterName}-${name}`;
      this.accessKeyIdKey = "access-key-id";
      this.secretAccessKeyKey = "secret-access-key";

      secretTemplate = {
        accessKeyIdKey: this.accessKeyIdKey,
        secretAccessKeyKey: this.secretAccessKeyKey,
        name: this.secret,
      };
    }

    const key = new BaseGarageKey(this, `${id}-garage-key`, {
      metadata: {
        name,
      },
      spec: {
        clusterRef: { name: clusterName, namespace: "garage" },
        importKey,
        secretTemplate,
      },
    });

    this.name = key.name;
  }
}

interface GarageBucketOpts {
  rwKeys?: GarageKey[];
  roKeys?: GarageKey[];
}

export class GarageBucket extends BaseGarageBucket {
  readonly clusterName: string;

  constructor(
    construct: Construct,
    clusterName: GarageClusterName,
    name: string,
    owners: GarageKey[],
    opts: GarageBucketOpts = {},
  ) {
    const id = `${construct.node.id}-garage-bucket-${clusterName}-${name}`;

    const keyPermissions = owners.map((k) => ({
      keyRef: k.name,
      owner: true,
      read: true,
      write: true,
    }));
    if (opts.rwKeys) {
      const rwKeys = opts.rwKeys.map((k) => ({
        keyRef: k.name,
        owner: false,
        read: true,
        write: true,
      }));
      keyPermissions.push(...rwKeys);
    }
    if (opts.roKeys) {
      const roKeys = opts.roKeys.map((k) => ({
        keyRef: k.name,
        owner: false,
        read: true,
        write: false,
      }));
      keyPermissions.push(...roKeys);
    }

    super(construct, id, {
      metadata: {
        name,
      },
      spec: {
        clusterRef: {
          name: clusterName,
          namespace: "garage",
        },
        keyPermissions,
      },
    });

    this.clusterName = clusterName;
  }
}

interface BucketSyncPolicyOpts {}

interface GcsSource {
  name: string;
  secret: string;
  credentialsKey: string;
}

interface GarageDestination {
  bucket: GarageBucket;
  key: GarageKey;
}

export class BucketSyncPolicy extends Construct {
  constructor(
    construct: Construct,
    source: GcsSource,
    destination: GarageDestination,
    opts: BucketSyncPolicyOpts = {},
  ) {
    const id = `${construct.node.id}-bucket-sync-policy-${destination.bucket.name}`;
    super(construct, id);

    const fromLiteral = (variable: string, value: string) => ({
      name: variable,
      value: value,
    });

    const fromSecret = (variable: string, secret: string, field: string) => ({
      name: variable,
      valueFrom: { secretKeyRef: { name: secret, key: field } },
    });

    new BaseBucketSyncPolicy(construct, `${id}-bucket-sync-policy`, {
      metadata: {
        name: destination.bucket.name,
      },
      spec: {
        source: source.name,
        sourceEnv: [
          fromLiteral("TYPE", "googlecloudstorage"),
          fromSecret(
            "SERVICE_ACCOUNT_CREDENTIALS",
            source.secret,
            source.credentialsKey,
          ),
        ],
        destination: destination.bucket.name,
        destinationEnv: [
          fromLiteral("TYPE", "s3"),
          fromLiteral("PROVIDER", "other"),
          fromSecret(
            "ACCESS_KEY_ID",
            destination.key.secret,
            destination.key.accessKeyIdKey,
          ),
          fromSecret(
            "SECRET_ACCESS_KEY",
            destination.key.secret,
            destination.key.secretAccessKeyKey,
          ),
          fromLiteral(
            "ENDPOINT",
            `http://${destination.bucket.clusterName}.garage.svc:3900`,
          ),
          fromLiteral("REGION", "garage"),
        ],
        schedule: "0 * * * *",
        syncHistoryLimit: 5,
        jobLabels: {
          "app.kubernetes.io/name": "bucket-sync-job",
        },
      },
    });
  }
}

export type WorkloadPorts = Record<string, number | [number, "TCP" | "UDP"]>;

export type ServicePortConfig =
  | number
  | [number, "TCP" | "UDP"]
  | [number, number]
  | [number, number, "TCP" | "UDP"]
  | { targetPort: number; port?: number; protocol?: "TCP" | "UDP" };

export type ServicePorts = Record<string, ServicePortConfig>;

export type WorkloadEnv = Record<
  string,
  | string
  | { secretKeyRef: { name: string; key: string; optional?: boolean } }
  | { configMapKeyRef: { name: string; key: string; optional?: boolean } }
  | { fieldRef: { fieldPath: string; apiVersion?: string } }
>;

type VolumeItem = { key: string; path?: string };

export type WorkloadVolumes = Record<
  string,
  | { pvc: { size: string; storageClass: string } | { name: string } }
  | { configMap: string; items?: VolumeItem[] }
  | { secret: string; items?: VolumeItem[] }
  | { emptyDir: { medium?: "Memory"; sizeLimit?: string } }
  | { hostPath: { path: string; type?: string } }
>;

function normalizePorts(ports: WorkloadPorts) {
  return Object.entries(ports).map(([name, v]) => {
    const [num, protocol] = Array.isArray(v) ? v : [v, "TCP" as const];
    return { name, num, protocol };
  });
}

function portsToContainerPorts(ports: WorkloadPorts | undefined) {
  if (!ports) return undefined;
  return normalizePorts(ports).map(({ name, num, protocol }) => ({
    name,
    containerPort: num,
    protocol,
  }));
}

function normalizeServicePortConfig(config: ServicePortConfig): {
  port: number;
  targetPort?: number;
  protocol: "TCP" | "UDP";
} {
  if (typeof config === "number") {
    return { port: config, protocol: "TCP" };
  }

  if (Array.isArray(config)) {
    if (config.length === 2) {
      const [first, second] = config;
      if (typeof second === "string") {
        // [port, protocol]
        return { port: first, protocol: second };
      } else {
        // [port, targetPort]
        return { port: first, targetPort: second, protocol: "TCP" };
      }
    } else if (config.length === 3) {
      // [port, targetPort, protocol]
      const [port, targetPort, protocol] = config;
      return { port, targetPort, protocol };
    }
  }

  // Object form
  const { targetPort, port, protocol = "TCP" } = config;
  return {
    port: port ?? targetPort,
    targetPort: port ? targetPort : undefined,
    protocol,
  };
}

function portsToServicePorts(ports: ServicePorts): any[] {
  const result = [];
  for (const [name, config] of Object.entries(ports)) {
    const { port, targetPort, protocol } = normalizeServicePortConfig(config);
    result.push({
      name,
      port,
      ...(targetPort && { targetPort }),
      protocol,
    });
  }
  return result;
}

function envToK8s(env: WorkloadEnv | undefined) {
  if (!env) return undefined;
  return Object.entries(env).map(([name, v]) => {
    if (typeof v === "string") return { name, value: v };
    return { name, valueFrom: v };
  });
}

type PvcTemplate = { size: string; storageClass: string };
type PvcReference = { name: string };
type PvcVolume = { pvc: PvcTemplate | PvcReference };
type EmptyDirVolume = { emptyDir: { medium?: "Memory"; sizeLimit?: string } };

const isPvcVolume = (v: WorkloadVolumes[string]): v is PvcVolume => "pvc" in v;
const isPvcTemplate = (pvc: PvcTemplate | PvcReference): pvc is PvcTemplate =>
  "size" in pvc;

function ensureNoPvcTemplateVolumes(volumes: WorkloadVolumes | undefined) {
  if (!volumes) return;
  const templateVolumes = Object.entries(volumes)
    .filter((entry): entry is [string, PvcVolume] => isPvcVolume(entry[1]))
    .filter(([, { pvc }]) => isPvcTemplate(pvc))
    .map(([name]) => name);
  if (templateVolumes.length > 0) {
    throw new Error(
      `Deployment does not support PVC templates (${templateVolumes.join(", ")}). Use StatefulSet for per-replica persistent storage, or reference an existing PVC with { pvc: { name } }.`,
    );
  }
}

function volumesToClaimTemplates(
  volumes: WorkloadVolumes | undefined,
): any[] | undefined {
  if (!volumes) return undefined;
  const result = Object.entries(volumes)
    .filter((entry): entry is [string, PvcVolume] => isPvcVolume(entry[1]))
    .filter((entry): entry is [string, { pvc: PvcTemplate }] =>
      isPvcTemplate(entry[1].pvc),
    )
    .map(([name, { pvc }]) => ({
      metadata: { name },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: pvc.size as any } },
        storageClassName: pvc.storageClass,
      },
    }));
  return result.length ? result : undefined;
}

function addWorkloadVolume(
  volumes: any[],
  volumeNames: Set<string>,
  name: string,
  volume: WorkloadVolumes[string],
) {
  if (volumeNames.has(name)) {
    throw new Error(`Volume "${name}" is already defined on this workload.`);
  }
  if (isPvcVolume(volume) && isPvcTemplate(volume.pvc)) {
    throw new Error(
      `addVolume does not support PVC templates (${name}). Declare it in the workload's volumes instead.`,
    );
  }
  volumes.push(...volumesToInlineVolumes({ [name]: volume })!);
  volumeNames.add(name);
}

function volumesToInlineVolumes(
  volumes: WorkloadVolumes | undefined,
): any[] | undefined {
  if (!volumes) return undefined;
  const result = Object.entries(volumes)
    .filter(([, v]) => !isPvcVolume(v) || !isPvcTemplate(v.pvc))
    .map(([name, v]) => {
      if ("configMap" in v)
        return {
          name,
          configMap: {
            name: v.configMap,
            items: v.items?.map((i) => ({ key: i.key, path: i.path ?? i.key })),
          },
        };
      if ("secret" in v)
        return {
          name,
          secret: {
            secretName: v.secret,
            items: v.items?.map((i) => ({ key: i.key, path: i.path ?? i.key })),
          },
        };
      if ("pvc" in v && !isPvcTemplate(v.pvc))
        return { name, persistentVolumeClaim: { claimName: v.pvc.name } };
      if ("hostPath" in v) return { name, hostPath: v.hostPath };
      const { medium, sizeLimit } = (v as EmptyDirVolume).emptyDir;
      return {
        name,
        emptyDir: {
          medium,
          ...(sizeLimit ? { sizeLimit: { value: sizeLimit } } : {}),
        },
      };
    });
  return result.length ? result : undefined;
}

interface WorkloadOpts {
  volumes?: WorkloadVolumes;
  hostNetwork?: boolean;
  nodeSelector?: Record<string, string>;
  securityContext?: GetSecurityContextOpts;
  podAnnotations?: Record<string, string>;
  dnsConfig?: { ndots?: number };
}

function dnsConfigToK8s(dnsConfig: WorkloadOpts["dnsConfig"]) {
  if (!dnsConfig?.ndots) return undefined;
  return { options: [{ name: "ndots", value: String(dnsConfig.ndots) }] };
}

interface ContainerResources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

type ProbeConfig = {
  http?: { path: string; port: number | string; scheme?: string };
  tcp?: { port: number | string };
  exec?: { command: string[] };
} & {
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
};

type VolumeMountOpts =
  | string
  | { mountPath: string; subPath?: string; readOnly?: boolean };

interface ContainerOpts {
  containerPorts?: WorkloadPorts;
  env?: WorkloadEnv;
  cmd?: string[];
  args?: string[];
  resources?: ContainerResources;
  volumeMounts?: Record<string, VolumeMountOpts>;
  securityContext?: GetSecurityContextOpts;
  readiness?: ProbeConfig;
  liveness?: ProbeConfig;
  startup?: ProbeConfig;
}

function resourcesToContainerResources(
  resources: ContainerResources | undefined,
) {
  if (!resources) return undefined;
  const wrap = (r: Record<string, string> | undefined) =>
    r
      ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { value: v }]))
      : undefined;
  return { limits: wrap(resources.limits), requests: wrap(resources.requests) };
}

function buildProbe(probeConfig: ProbeConfig | undefined) {
  if (!probeConfig) return undefined;

  const { http, tcp, exec, ...timingConfig } = probeConfig;
  const probe: any = { ...timingConfig };

  if (http) {
    probe.httpGet = {
      ...http,
      port: { value: http.port },
    };
  } else if (tcp) {
    probe.tcpSocket = {
      ...tcp,
      port: { value: tcp.port },
    };
  } else if (exec) {
    probe.exec = exec;
  }

  return Object.keys(probe).length > 0 ? probe : undefined;
}

function buildContainer(
  podSecCtxOpts: GetSecurityContextOpts,
  containerName: string,
  image: string,
  opts: ContainerOpts,
) {
  const mergedOpts = { ...podSecCtxOpts, ...opts.securityContext };
  const { container: containerSec } = getSecurityContext(mergedOpts);

  const mounts = opts.volumeMounts
    ? Object.entries(opts.volumeMounts).map(([name, mount]) => {
        const { mountPath, subPath, readOnly } =
          typeof mount === "string" ? { mountPath: mount } : mount;
        return { name, mountPath, subPath, readOnly };
      })
    : undefined;

  return {
    name: containerName,
    image,
    command: opts.cmd,
    args: opts.args,
    env: envToK8s(opts.env),
    ports: portsToContainerPorts(opts.containerPorts),
    resources: resourcesToContainerResources(opts.resources),
    securityContext: containerSec,
    volumeMounts: mounts,
    readinessProbe: buildProbe(opts.readiness),
    livenessProbe: buildProbe(opts.liveness),
    startupProbe: buildProbe(opts.startup),
  };
}

export class StatefulSet extends BaseStatefulSet {
  private readonly _containers: any[];
  private readonly _initContainers: any[];
  private readonly _volumes: any[];
  private readonly _volumeNames: Set<string>;
  private readonly _podSecCtxOpts: GetSecurityContextOpts;
  private readonly _selector: Record<string, string>;

  constructor(chart: Chart, name: string, opts: WorkloadOpts = {}) {
    const id = `${chart.node.id}-statefulset-${name}`;
    const podSecCtxOpts = opts.securityContext ?? {};
    const secCtx = getSecurityContext(podSecCtxOpts);
    const selector = { "app.kubernetes.io/name": name };
    const containers: any[] = [];
    const initContainers: any[] = [];
    const volumes = volumesToInlineVolumes(opts.volumes) ?? [];
    super(chart, id, {
      metadata: { name },
      spec: {
        selector: { matchLabels: selector },
        template: {
          metadata: {
            labels: selector,
            annotations: opts.podAnnotations,
          },
          spec: {
            hostNetwork: opts.hostNetwork,
            nodeSelector: opts.nodeSelector,
            securityContext: secCtx.pod,
            dnsConfig: dnsConfigToK8s(opts.dnsConfig),
            volumes,
            initContainers,
            containers,
          },
        },
        volumeClaimTemplates: volumesToClaimTemplates(opts.volumes),
      },
    });
    this._containers = containers;
    this._initContainers = initContainers;
    this._volumes = volumes;
    this._volumeNames = new Set(Object.keys(opts.volumes ?? {}));
    this._podSecCtxOpts = podSecCtxOpts;
    this._selector = selector;
  }

  addInitContainer(
    containerName: string,
    image: string,
    opts: ContainerOpts = {},
  ): this {
    this._initContainers.push(
      buildContainer(this._podSecCtxOpts, containerName, image, opts),
    );
    return this;
  }

  addContainer(
    containerName: string,
    image: string,
    opts: ContainerOpts = {},
  ): this {
    this._containers.push(
      buildContainer(this._podSecCtxOpts, containerName, image, opts),
    );
    return this;
  }

  addVolume(name: string, volume: WorkloadVolumes[string]): this {
    addWorkloadVolume(this._volumes, this._volumeNames, name, volume);
    return this;
  }

  createService(ports: ServicePorts): Service {
    return new Service(this.node.scope!, `${this.node.id}-service`, {
      metadata: { name: this.name },
      spec: { selector: this._selector, ports: portsToServicePorts(ports) },
    });
  }
}

interface DeploymentOpts extends WorkloadOpts {
  replicas?: number;
}

export class Deployment extends BaseDeployment {
  private readonly _containers: any[];
  private readonly _initContainers: any[];
  private readonly _volumes: any[];
  private readonly _volumeNames: Set<string>;
  private readonly _podSecCtxOpts: GetSecurityContextOpts;
  private readonly _selector: Record<string, string>;

  constructor(chart: Chart, name: string, opts: DeploymentOpts = {}) {
    ensureNoPvcTemplateVolumes(opts.volumes);
    const id = `${chart.node.id}-deployment-${name}`;
    const podSecCtxOpts = opts.securityContext ?? {};
    const secCtx = getSecurityContext(podSecCtxOpts);
    const selector = { "app.kubernetes.io/name": name };
    const containers: any[] = [];
    const initContainers: any[] = [];
    const volumes = volumesToInlineVolumes(opts.volumes) ?? [];
    super(chart, id, {
      metadata: { name },
      spec: {
        replicas: opts.replicas ?? 1,
        selector: { matchLabels: selector },
        template: {
          metadata: { labels: selector },
          spec: {
            hostNetwork: opts.hostNetwork,
            nodeSelector: opts.nodeSelector,
            securityContext: secCtx.pod,
            dnsConfig: dnsConfigToK8s(opts.dnsConfig),
            volumes,
            initContainers: initContainers,
            containers,
          },
        },
      },
    });
    this._containers = containers;
    this._initContainers = initContainers;
    this._volumes = volumes;
    this._volumeNames = new Set(Object.keys(opts.volumes ?? {}));
    this._podSecCtxOpts = podSecCtxOpts;
    this._selector = selector;
  }

  addInitContainer(
    containerName: string,
    image: string,
    opts: ContainerOpts = {},
  ): this {
    this._initContainers.push(
      buildContainer(this._podSecCtxOpts, containerName, image, opts),
    );
    return this;
  }

  addContainer(
    containerName: string,
    image: string,
    opts: ContainerOpts = {},
  ): this {
    this._containers.push(
      buildContainer(this._podSecCtxOpts, containerName, image, opts),
    );
    return this;
  }

  addVolume(name: string, volume: WorkloadVolumes[string]): this {
    addWorkloadVolume(this._volumes, this._volumeNames, name, volume);
    return this;
  }

  createService(ports: ServicePorts): Service {
    return new Service(this.node.scope!, `${this.node.id}-service`, {
      metadata: { name: this.name },
      spec: { selector: this._selector, ports: portsToServicePorts(ports) },
    });
  }
}

export class DaemonSet extends BaseDaemonSet {
  private readonly _containers: any[];
  private readonly _initContainers: any[];
  private readonly _volumes: any[];
  private readonly _volumeNames: Set<string>;
  private readonly _podSecCtxOpts: GetSecurityContextOpts;
  private readonly _selector: Record<string, string>;

  constructor(chart: Chart, name: string, opts: WorkloadOpts = {}) {
    ensureNoPvcTemplateVolumes(opts.volumes);
    const id = `${chart.node.id}-daemonset-${name}`;
    const podSecCtxOpts = opts.securityContext ?? {};
    const secCtx = getSecurityContext(podSecCtxOpts);
    const selector = { "app.kubernetes.io/name": name };
    const containers: any[] = [];
    const initContainers: any[] = [];
    const volumes = volumesToInlineVolumes(opts.volumes) ?? [];
    super(chart, id, {
      metadata: { name },
      spec: {
        selector: { matchLabels: selector },
        template: {
          metadata: {
            labels: selector,
            annotations: opts.podAnnotations,
          },
          spec: {
            hostNetwork: opts.hostNetwork,
            nodeSelector: opts.nodeSelector,
            securityContext: secCtx.pod,
            dnsConfig: dnsConfigToK8s(opts.dnsConfig),
            volumes,
            initContainers,
            containers,
          },
        },
      },
    });
    this._containers = containers;
    this._initContainers = initContainers;
    this._volumes = volumes;
    this._volumeNames = new Set(Object.keys(opts.volumes ?? {}));
    this._podSecCtxOpts = podSecCtxOpts;
    this._selector = selector;
  }

  addInitContainer(
    containerName: string,
    image: string,
    opts: ContainerOpts = {},
  ): this {
    this._initContainers.push(
      buildContainer(this._podSecCtxOpts, containerName, image, opts),
    );
    return this;
  }

  addContainer(
    containerName: string,
    image: string,
    opts: ContainerOpts = {},
  ): this {
    this._containers.push(
      buildContainer(this._podSecCtxOpts, containerName, image, opts),
    );
    return this;
  }

  addVolume(name: string, volume: WorkloadVolumes[string]): this {
    addWorkloadVolume(this._volumes, this._volumeNames, name, volume);
    return this;
  }

  createService(ports: ServicePorts): Service {
    return new Service(this.node.scope!, `${this.node.id}-service`, {
      metadata: { name: this.name },
      spec: { selector: this._selector, ports: portsToServicePorts(ports) },
    });
  }
}

export class BucketServer extends Deployment {
  constructor(construct: Chart, bucket: GarageBucket, key: GarageKey) {
    super(construct, `bucket-server-${bucket.name}`, {});
    this.addContainer("rclone", "rclone/rclone:1.73.1", {
      containerPorts: { http: 8080 },
      args: ["serve", "http", `source:${bucket.name}`, "--addr=:8080"],
      env: {
        RCLONE_CONFIG_SOURCE_TYPE: "s3",
        RCLONE_CONFIG_SOURCE_PROVIDER: "Other",
        RCLONE_CONFIG_SOURCE_ACCESS_KEY_ID: {
          secretKeyRef: { name: key.secret, key: key.accessKeyIdKey },
        },
        RCLONE_CONFIG_SOURCE_SECRET_ACCESS_KEY: {
          secretKeyRef: { name: key.secret, key: key.secretAccessKeyKey },
        },
        RCLONE_CONFIG_SOURCE_ENDPOINT: `http://${bucket.clusterName}.garage.svc:3900`,
        RCLONE_CONFIG_SOURCE_REGION: "garage",
      },
    });
  }
}

export const getAssetsServerUrl = (path: string) => {
  return `http://bucket-server-assets-server.assets-server.svc:8080/${path}`;
};
