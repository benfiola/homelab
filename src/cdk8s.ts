import {
  ApiObject,
  Chart as BaseChart,
  Helm as BaseHelm,
  Include,
} from "cdk8s";
import { Construct } from "constructs";
import { writeFile } from "fs/promises";
import { get } from "lodash";
import {
  GarageBucket as BaseGarageBucket,
  GarageKey as BaseGarageKey,
} from "../assets/garage-operator/garage.rajsingh.info";
import {
  HttpRoute as BaseHttpRoute,
  TcpRoute as BaseTcpRoute,
  UdpRoute as BaseUdpRoute,
} from "../assets/gateway-api/gateway.networking.k8s.io";
import {
  Namespace as BaseNamespace,
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

export interface KustomizationOpts {
  url?: string;
  dynamic?: Record<string, any>;
}

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
    const path = opts.name ?? construct.node.id;

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

export const gateways = ["public", "trusted"] as const;
export type Gateway = (typeof gateways)[number];

interface RouteTarget {
  apiVersion?: string;
  kind: string;
  name: string;
}

export class HttpRoute extends BaseHttpRoute {
  constructor(construct: Construct, gateway: Gateway, hostname: string) {
    const id = `${construct}-http-route-${hostname}`;

    const annotations: Record<string, string> = {};
    if (gateway === "trusted") {
      annotations["homelab.benfiola.com/use-external-dns-mikrotik"] = "";
    } else if (gateway === "public") {
      annotations["homelab.benfiola.com/use-external-dns-cloudflare"] = "";
    }

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
    port: number,
  ) {
    const id = `${construct}-tcp-route-${hostname}`;

    const annotations: Record<string, string> = {
      "gateway-route-sync.homelab-helper.benfiola.com/port": `${port}`,
      "external-dns.alpha.kubernetes.io/hostname": hostname,
    };
    if (gateway === "trusted") {
      annotations["homelab.benfiola.com/use-external-dns-mikrotik"] = "";
    } else if (gateway === "public") {
      annotations["homelab.benfiola.com/use-external-dns-cloudflare"] = "";
    }

    super(construct, id, {
      metadata: {
        name: hostname,
        annotations,
      },
      spec: {
        parentRefs: [
          {
            name: gateway,
            namespace: "gateway",
          },
        ],
        rules: [],
      },
    });
  }

  match(to: RouteTarget, port: string | number) {
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
    });
    return this;
  }
}

export class UdpRoute extends BaseUdpRoute {
  constructor(
    construct: Construct,
    gateway: Gateway,
    hostname: string,
    port: number,
  ) {
    const id = `${construct}-udp-route-${hostname}`;

    const annotations: Record<string, string> = {
      "gateway-route-sync.homelab-helper.benfiola.com/port": `${port}`,
      "external-dns.alpha.kubernetes.io/hostname": hostname,
    };
    if (gateway === "trusted") {
      annotations["homelab.benfiola.com/use-external-dns-mikrotik"] = "";
    } else if (gateway === "public") {
      annotations["homelab.benfiola.com/use-external-dns-cloudflare"] = "";
    }

    super(construct, id, {
      metadata: {
        name: hostname,
        annotations,
      },
      spec: {
        parentRefs: [
          {
            name: gateway,
            namespace: "gateway",
          },
        ],
        rules: [],
      },
    });
  }

  match(to: RouteTarget, port: string | number) {
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
    });
    return this;
  }
}

interface GetSecurityContextOpts {
  gid?: number;
  uid?: number;
  caps?: string[];
}

export const getSecurityContext = (opts: GetSecurityContextOpts = {}) => {
  const gid = opts.gid ?? defaultGid;
  const uid = opts.uid ?? defaultUid;
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
        GOOGLE_PROJECT_ID: "592515172912",
        GOOGLE_APPLICATION_CREDENTIALS: secretRef(
          "google-cloud-credentials-file",
        ),
        RESTIC_REPOSITORY: `gs:volsync-wf98ys:/${namespace}/${pvc}`,
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
  accessKeyId: string;
  secretAccessKey: string;
  path?: string;
  role?: string;
}

export class GarageKey extends Construct {
  readonly name: string;

  constructor(
    construct: Construct,
    clusterName: GarageClusterName,
    name: string,
    auth: VaultAuth,
    opts: GarageKeyOpts,
  ) {
    const id = `${construct.node.id}-garage-key-${clusterName}-${name}`;
    super(construct, id);

    const secret = new VaultDynamicSecret(this, auth, (secretRef) => ({
      "access-key-id": secretRef(opts.accessKeyId),
      "secret-key-id": secretRef(opts.secretAccessKey),
    }));

    const key = new BaseGarageKey(this, `${id}-garage-key`, {
      metadata: {
        name,
      },
      spec: {
        clusterRef: { name: clusterName, namespace: "garage" },
        importKey: { secretRef: { name: secret.name } },
      },
    });

    this.name = key.name;
  }
}

export class GarageBucket extends BaseGarageBucket {
  constructor(
    construct: Construct,
    clusterName: GarageClusterName,
    name: string,
    keys: GarageKey[],
  ) {
    const id = `${construct.node.id}-garage-bucket-${clusterName}-${name}`;

    const keyPermissions = keys.map((k) => ({
      keyRef: k.name,
      read: true,
      write: true,
    }));

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
  }
}
