type Obj = Record<string, any>;

// everything that ties an app to external secrets. the contract apps rely on:
// `appSecrets(app, name, keys)` produces a Secret of that name in the app's namespace, holding those
// keys of the app's section of the `apps` file.
//
// the `apps` secret of bitwarden is read into a Secret in external-secrets-operator (see that app).
// generated values (see `generatedNames`) get Secrets of their own, merged with `apps`. a PushSecret
// there builds each app's Secret from the result, and pushes it into the app's namespace through a
// SecretStore of its own: the app's namespace holds nothing else.

// where the pushing happens, and what it uses
export const esoNamespace = "external-secrets-operator";
export const pusherServiceAccount = "secrets-pusher";

// the Secret holding the token of the machine account that reads bitwarden, in the namespace above.
// it can't come from bitwarden, so `just bootstrap` makes it (see bootstrap.yaml)
export const credentialsSecret = "bitwarden-credentials";

// the Secret holding the `apps` file, in the key of the same name
export const blobSecret = "apps";

// the Secret PushSecrets read: `apps` and every generated Secret, merged. refreshed quickly: it's free
export const mergedSecret = "merged";
export const mergeRefreshInterval = "5s";

// the kinds of generated value: the generator all values of a kind share, and the key it writes
const generators = {
  string: {
    object: {
      apiVersion: "generators.external-secrets.io/v1alpha1",
      kind: "Password",
      metadata: { name: "password" },
      // no symbols: values go into env vars and command lines
      spec: { length: 32, symbols: 0, allowRepeat: true },
    },
    key: "password",
  },
} as const;
type GeneratedKind = keyof typeof generators;

// values generated once in the cluster, not kept in `apps`, and their kinds. each has its own
// Secret, so adding one doesn't regenerate the others. add one here to use it (`generatedString`)
export const generated = {
  "garage-admin-token": "string",
} as const satisfies Record<string, GeneratedKind>;
export type GeneratedName<K extends GeneratedKind = GeneratedKind> = {
  [N in keyof typeof generated]: (typeof generated)[N] extends K ? N : never;
}[keyof typeof generated];
export const generatedNames = Object.keys(generated) as GeneratedName[];

// the Secret holding a generated value (also its key in the merged Secret)
export const generatedSecretName = (name: GeneratedName) =>
  `generated-${checked("name", name)}`;

// the keys of bucket-sync's section, which apps syncing from backblaze are given
export const bucketSyncKeys = [
  "backblaze-application-key",
  "backblaze-application-key-id",
  "encryption-key",
];

// names and keys go into templates and object names
const checked = (what: string, value: string) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${what} '${value}' is not a plain name`);
  }
  return value;
};

// refers to a key of an app's section of the `apps` file, inside a template. a key that isn't there
// fails the sync: indexing a missing key quietly gives an empty value, which would be pushed as a
// password. `fail` is not available in external secrets' templates, so an invalid regular
// expression (which says which key is missing) is how the template fails.
export const secretRef = (key: string, from: string) => {
  const section = `(index (fromYaml (toString .${blobSecret})) "${checked("app", from)}")`;
  const name = checked("key", key);
  return `{{ if hasKey ${section} "${name}" }}{{ index ${section} "${name}" }}{{ else }}{{ mustRegexMatch "( missing key ${from}.${name}" "" }}{{ end }}`;
};

const generatedRef = (name: GeneratedName, kind: GeneratedKind) => {
  if (generated[name] !== kind) {
    throw new Error(`'${name}' is not a generated ${kind} (see generated)`);
  }
  const key = generatedSecretName(name);
  return `{{ with index . "${key}" }}{{ toString . }}{{ else }}{{ mustRegexMatch "( missing generated value ${name}" "" }}{{ end }}`;
};

// refers to a generated string, inside a template. like `secretRef`, a missing value fails the sync
export const generatedString = (name: GeneratedName<"string">) =>
  generatedRef(name, "string");

// the generators in use, and an ExternalSecret per value that runs one once. it owns its Secret:
// deleting the Secret generates a new value
export const generatedObjects = (): Obj[] => [
  ...new Set(Object.values(generated))
    .values()
    .map((k) => generators[k].object),
  ...generatedNames.map((name) => ({
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name: generatedSecretName(name) },
    spec: {
      // never refreshed: a new value would break what holds the old one
      refreshInterval: "0",
      target: { name: generatedSecretName(name) },
      dataFrom: [
        {
          sourceRef: {
            generatorRef: {
              apiVersion: generators[generated[name]].object.apiVersion,
              kind: generators[generated[name]].object.kind,
              name: generators[generated[name]].object.metadata.name,
            },
          },
        },
      ],
    },
  })),
];

// merges `apps` and the generated Secrets, read through `pushStore(esoNamespace)`
export const mergedExternalSecret = (): Obj => ({
  apiVersion: "external-secrets.io/v1",
  kind: "ExternalSecret",
  metadata: { name: mergedSecret },
  spec: {
    refreshInterval: mergeRefreshInterval,
    secretStoreRef: { kind: "SecretStore", name: esoNamespace },
    target: { name: mergedSecret },
    data: [
      {
        secretKey: blobSecret,
        remoteRef: { key: blobSecret, property: blobSecret },
      },
      ...generatedNames.map((name) => ({
        secretKey: generatedSecretName(name),
        remoteRef: {
          key: generatedSecretName(name),
          property: generators[generated[name]].key,
        },
      })),
    ],
  },
});

// the store that writes into an app's namespace. it is used by the PushSecrets in
// external-secrets-operator alone: a SecretStore can't be used from other namespaces
export const pushStore = (namespace: string): Obj => ({
  apiVersion: "external-secrets.io/v1",
  kind: "SecretStore",
  metadata: { name: checked("namespace", namespace), namespace: esoNamespace },
  spec: {
    provider: {
      kubernetes: {
        auth: { serviceAccount: { name: pusherServiceAccount } },
        remoteNamespace: namespace,
        server: {
          caProvider: {
            key: "ca.crt",
            name: "kube-root-ca.crt",
            type: "ConfigMap",
          },
        },
      },
    },
  },
});

export interface SecretOptions {
  // the namespace to create the Secret in (default: the app's name)
  namespace?: string;
  // the app whose section is read (default: the app itself)
  from?: string;
}

export interface PushSecretOptions {
  namespace: string;
  // the Secret to create
  name: string;
  // Secret keys, mapped to templates (use `secretRef` to read keys of the section)
  templates: Record<string, string>;
}

// builds a Secret's keys from templates over the `apps` file, and pushes them into a namespace
export const pushSecret = ({
  namespace,
  name,
  templates,
}: PushSecretOptions): Obj => {
  const keys = Object.keys(templates);
  if (keys.length === 0) {
    throw new Error(`the Secret ${name} in ${namespace} has no keys`);
  }
  return {
    apiVersion: "external-secrets.io/v1alpha1",
    kind: "PushSecret",
    metadata: {
      name: `${checked("namespace", namespace)}-${checked("name", name)}`,
      namespace: esoNamespace,
    },
    spec: {
      // the apps file is local, so there is no cost to pushing often
      refreshInterval: "1m",
      deletionPolicy: "Delete",
      updatePolicy: "Replace",
      secretStoreRefs: [{ kind: "SecretStore", name: namespace }],
      selector: { secret: { name: mergedSecret } },
      template: { engineVersion: "v2", data: templates },
      data: keys.map((key) => ({
        match: {
          remoteRef: { property: checked("key", key), remoteKey: name },
          secretKey: key,
        },
      })),
    },
  };
};

// copies keys of an app's section into a Secret, unchanged
export const appSecrets = (
  app: string,
  name: string,
  keys: readonly string[],
  { namespace = app, from = app }: SecretOptions = {},
): Obj[] => [
  pushSecret({
    name,
    namespace,
    templates: Object.fromEntries(
      keys.map((key) => [key, secretRef(key, from)]),
    ),
  }),
];

// the same, but the Secret's keys are built from templates over the section's keys
export const appTemplatedSecrets = (
  app: string,
  name: string,
  templates: Record<string, string>,
  { namespace = app }: SecretOptions = {},
): Obj[] => [pushSecret({ name, namespace, templates })];

// a Secret an app was given, and the keys it holds: what workloads read it through
export interface SecretKeys<K extends string = string> {
  readonly name: string;
  // an env var source for a key of the Secret
  key(key: K): { secretKeyRef: { name: string; key: string } };
}

export const secretKeys = <K extends string>(
  name: string,
  keys: readonly K[],
): SecretKeys<K> => ({
  name,
  key: (key) => {
    if (!keys.includes(key)) {
      throw new Error(`the Secret ${name} has no key '${key}'`);
    }
    return { secretKeyRef: { name, key } };
  },
});
