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
  HttpRoute as BaseHttpRoute,
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

export class VaultAuth extends Construct {
  readonly serviceAccount: ServiceAccount;
  readonly auth: BaseVaultAuth;

  constructor(construct: Construct, role: string, serviceAccount: string) {
    const id = `${construct.node.id}-vault-auth-${serviceAccount}`;
    super(construct, id);

    this.serviceAccount = new ServiceAccount(
      construct,
      `${id}-service-account`,
      {
        metadata: {
          name: serviceAccount,
        },
      },
    );

    this.auth = new BaseVaultAuth(construct, `${id}-vault-auth`, {
      metadata: {
        name: role,
      },
      spec: {
        kubernetes: {
          role,
          serviceAccount: this.serviceAccount.name,
        },
        method: VaultAuthMethod.KUBERNETES,
        mount: "kubernetes",
      },
    });
  }
}

export class VaultStaticSecret extends Construct {
  readonly serviceAccount: ServiceAccount;
  readonly auth: BaseVaultAuth;
  readonly secret: BaseVaultStaticSecret;

  constructor(
    construct: Construct,
    auth: VaultAuth,
    name: string,
    path: string,
  ) {
    const id = `${construct.node.id}-vault-static-secret-${name}`;
    super(construct, id);

    this.serviceAccount = auth.serviceAccount;
    this.auth = auth.auth;

    this.secret = new BaseVaultStaticSecret(
      construct,
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
          vaultAuthRef: this.auth.name,
        },
      },
    );
  }
}

export class VaultDynamicSecret extends Construct {
  readonly serviceAccount: ServiceAccount;
  readonly auth: BaseVaultAuth;
  readonly secret: BaseVaultDynamicSecret;

  constructor(
    construct: Construct,
    auth: VaultAuth,
    name: string,
    path: string,
    templates: Record<string, string>,
  ) {
    const id = `${construct.node.id}-vault-dynamic-secret-${name}`;
    super(construct, id);

    this.serviceAccount = auth.serviceAccount;
    this.auth = auth.auth;

    const specTemplates: Record<string, VaultSecretTemplate> = {};
    for (const key of Object.keys(templates)) {
      specTemplates[key] = {
        text: templates[key],
      };
    }

    this.secret = new BaseVaultDynamicSecret(
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
          vaultAuthRef: this.auth.name,
        },
      },
    );
  }
}

interface HelmOpts {
  skipCRDs?: boolean;
}

export class Helm extends BaseHelm {
  constructor(
    construct: BaseChart,
    id: string,
    chart: string,
    valuesAndOpts: HelmOpts | Record<string, any> = {},
  ) {
    const { skipCRDs, ...values } = valuesAndOpts;

    const helmFlags = ["--kube-version=1.34.0", "--skip-tests"];
    if (!skipCRDs) {
      helmFlags.push("--include-crds");
    }

    super(construct, id, {
      chart,
      helmFlags,
      namespace: construct.namespace,
      releaseName: construct.node.id,
      values,
    });
  }
}

export const gateways = ["public", "trusted"] as const;
export type Gateway = (typeof gateways)[number];

interface HttpRouteTarget {
  apiVersion?: string;
  kind: string;
  name: string;
}

export class HttpRoute extends BaseHttpRoute {
  constructor(construct: Construct, gateway: Gateway, hostname: string) {
    const id = `${construct}-http-route-${gateway}-${hostname}`;

    super(construct, id, {
      metadata: {
        name: hostname,
      },
      spec: {
        hostnames: [hostname],
        parentRefs: [{ name: gateway, namespace: "gateway" }],
      },
    });
  }

  match(to: HttpRouteTarget, port: string | number, path: string = "/") {
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

interface UdpRouteTarget {
  apiVersion?: string;
  kind: string;
  name: string;
}

export class UdpRoute extends BaseUdpRoute {
  constructor(construct: Construct, gateway: Gateway, name: string) {
    const id = `${construct}-udp-route-${gateway}-${name}`;

    super(construct, id, {
      metadata: {
        name,
      },
      spec: {
        parentRefs: [{ name: gateway, namespace: "gateway" }],
        rules: [],
      },
    });
  }

  match(to: UdpRouteTarget, port: string | number) {
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
    super(construct, "volsync-mover", "volsync-mover-vault-secrets-operator");
  }
}

interface VolsyncBackupOpts {
  securityContext?: PodSecurityContext;
}

export class VolsyncBackup extends Construct {
  readonly auth: VolsyncAuth;
  readonly vaultSecret: VaultDynamicSecret;
  readonly replicationSource: ReplicationSource;

  constructor(
    chart: Chart,
    auth: VolsyncAuth,
    pvc: string,
    opts: VolsyncBackupOpts = {},
  ) {
    const id = `${chart.node.id}-volsync-backup-${pvc}`;
    super(chart, id);

    this.auth = auth;

    const namespace = chart.namespace;
    this.vaultSecret = new VaultDynamicSecret(
      chart,
      this.auth,
      `volsync-mover-${pvc}`,
      "volsync",
      {
        GOOGLE_PROJECT_ID: "592515172912",
        GOOGLE_APPLICATION_CREDENTIALS: `{{ get (get .Secrets "data") "google-cloud-credentials-file" }}`,
        RESTIC_REPOSITORY: `gs:volsync-wf98ys:/${namespace}/${pvc}`,
        RESTIC_PASSWORD: `{{ get (get .Secrets "data") "restic-password" }}`,
      },
    );

    this.replicationSource = new ReplicationSource(
      chart,
      `replications-source-${pvc}`,
      {
        metadata: { name: pvc },
        spec: {
          restic: {
            copyMethod: "Clone" as any,
            moverPodLabels: {
              "app.kubernetes.io/name": "volsync-mover",
            },
            moverSecurityContext: opts.securityContext,
            pruneIntervalDays: 1,
            repository: getField(
              this.vaultSecret.secret,
              "spec.destination.name",
            ),
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
      },
    );
  }
}
