type Obj = Record<string, any>;

export const garageCluster = { name: "garage", namespace: "garage" };

export const garageEndpoint = `http://${garageCluster.name}.${garageCluster.namespace}.svc:3900`;

// lets `kinds` in `namespace` reference the cluster (cross-namespace references require one, in
// the cluster's namespace). named for the namespace and `name`, as a PushSecret is
export const garageReferenceGrant = (
  namespace: string,
  name: string,
  kinds: string[] = [],
): Obj => ({
  apiVersion: "garage.rajsingh.info/v1beta1",
  kind: "GarageReferenceGrant",
  metadata: {
    name: `${namespace}-${name}`,
    namespace: garageCluster.namespace,
  },
  spec: {
    from: kinds.map((kind) => ({ kind, namespace })),
    to: [{ kind: "GarageCluster", name: garageCluster.name }],
  },
});

export interface GarageKey {
  name: string;
  // the Secret holding the key, and its entries
  secret: string;
  accessKeyIdKey: string;
  secretAccessKeyKey: string;
  object: Obj;
}

export interface GarageKeyOptions {
  // import an existing key from a Secret instead of having garage generate one
  existingSecret?: {
    name: string;
    accessKeyId: string;
    secretAccessKey: string;
    namespace: string;
  };
}

// an access key; unless imported, garage generates it into a Secret named `garage-key-garage-<name>`
export const garageKey = (
  name: string,
  opts: GarageKeyOptions = {},
): GarageKey => {
  const imported = opts.existingSecret;
  const secret = imported?.name ?? `garage-key-${garageCluster.name}-${name}`;
  const accessKeyIdKey = imported?.accessKeyId ?? "access-key-id";
  const secretAccessKeyKey = imported?.secretAccessKey ?? "secret-access-key";

  return {
    name,
    secret,
    accessKeyIdKey,
    secretAccessKeyKey,
    object: {
      apiVersion: "garage.rajsingh.info/v1beta1",
      kind: "GarageKey",
      metadata: { name },
      spec: {
        clusterRef: garageCluster,
        ...(imported
          ? {
              importKey: {
                secretRef: { name: secret, namespace: imported.namespace },
                accessKeyId: accessKeyIdKey,
                secretAccessKey: secretAccessKeyKey,
              },
            }
          : {
              secretTemplate: {
                accessKeyIdKey,
                secretAccessKeyKey,
                name: secret,
              },
            }),
      },
    },
  };
};

export interface GarageBucketOptions {
  rwKeys?: GarageKey[];
  roKeys?: GarageKey[];
}

// a bucket: `owners` own it, `rwKeys` can read and write it, `roKeys` can only read it
export const garageBucket = (
  name: string,
  owners: GarageKey[],
  opts: GarageBucketOptions = {},
): Obj => {
  const permission = (key: GarageKey, owner: boolean, write: boolean) => ({
    keyRef: { name: key.name },
    owner,
    read: true,
    write,
  });

  return {
    apiVersion: "garage.rajsingh.info/v1beta1",
    kind: "GarageBucket",
    metadata: { name },
    spec: {
      clusterRef: garageCluster,
      keyPermissions: [
        ...owners.map((k) => permission(k, true, true)),
        ...(opts.rwKeys ?? []).map((k) => permission(k, false, true)),
        ...(opts.roKeys ?? []).map((k) => permission(k, false, false)),
      ],
    },
  };
};

export interface BucketSyncPolicyOptions {
  // the garage bucket to sync into, and a key that can write to it
  bucket: string;
  key: GarageKey;
  // where to sync from (a b2 path)
  source: string;
  // the Secret holding the backblaze credentials and encryption key
  credentials: string;
  syncTimeout?: string;
}

// syncs a backblaze path into a garage bucket on a schedule
export const bucketSyncPolicy = (opts: BucketSyncPolicyOptions): Obj => {
  const literal = (name: string, value: string) => ({ name, value });
  const fromSecret = (name: string, secret: string, key: string) => ({
    name,
    valueFrom: { secretKeyRef: { name: secret, key } },
  });

  return {
    apiVersion: "bucket-sync.homelab-images.benfiola.com/v1",
    kind: "BucketSyncPolicy",
    metadata: { name: opts.bucket },
    spec: {
      source: opts.source,
      sourceEnv: [
        literal("TYPE", "b2"),
        fromSecret("ACCOUNT", opts.credentials, "backblaze-application-key-id"),
        fromSecret("KEY", opts.credentials, "backblaze-application-key"),
      ],
      sourceEncryptionKey: {
        secretKeyRef: { name: opts.credentials, key: "encryption-key" },
      },
      destination: opts.bucket,
      destinationEnv: [
        literal("TYPE", "s3"),
        literal("PROVIDER", "other"),
        fromSecret("ACCESS_KEY_ID", opts.key.secret, opts.key.accessKeyIdKey),
        fromSecret(
          "SECRET_ACCESS_KEY",
          opts.key.secret,
          opts.key.secretAccessKeyKey,
        ),
        literal("ENDPOINT", garageEndpoint),
        literal("REGION", "garage"),
      ],
      schedule: "0 * * * *",
      syncHistoryLimit: 5,
      jobLabels: { "app.kubernetes.io/name": "bucket-sync-job" },
      timeout: opts.syncTimeout,
    },
  };
};
