type Obj = Record<string, any>;

// everything that ties an app to external secrets. the contract apps rely on:
// `appSecrets(app, name, entries)` produces a Secret of that name in the app's namespace, holding
// keys of the `apps` file's sections.
//
// the `apps` secret of bitwarden is read into a Secret in external-secrets-operator (see that app),
// with the values apps generate merged in as keys of their app's section. a PushSecret there builds
// each app's Secret from it, and pushes it into the app's namespace through a SecretStore of its
// own: the app's namespace holds nothing else.

// where the pushing happens, and what it uses
export const esoNamespace = "external-secrets-operator";
export const pusherServiceAccount = "secrets-pusher";

// the Secret holding the token of the machine account that reads bitwarden, in the namespace above.
// it can't come from bitwarden, so `just bootstrap` makes it (see bootstrap.yaml)
export const credentialsSecret = "bitwarden-credentials";

// the Secret holding the `apps` file, in the key of the same name
export const blobSecret = "apps";

// the `apps` file with the generated values merged in, which PushSecrets read. refreshed quickly:
// it's free
const mergedSecret = "merged";
const mergeRefreshInterval = "5s";

// the kinds of generated value: the generator its values share, and the key it writes
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
export type GeneratedKind = keyof typeof generators;

// the generators, which the ESO app creates
export const generatorObjects = (): Obj[] =>
  Object.values(generators).map((g) => g.object);

// the Secret holding a generated value
export const generatedKey = (owner: string, name: string) =>
  `generated-${checked("app", owner)}-${checked("name", name)}`;

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

// say where a generated value goes in the `apps` file: the section, and the key
const generatedApp = "homelab.benfiola.com/generated-app";
const generatedName = "homelab.benfiola.com/generated-key";

// runs a generator once, into the Secret `generatedKey` names. it owns the Secret: deleting it
// generates a new value
export const generatedExternalSecret = (
  owner: string,
  name: string,
  kind: GeneratedKind,
): Obj => {
  const { object } = generators[kind];
  const key = generatedKey(owner, name);
  return {
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: {
      name: key,
      annotations: { [generatedApp]: owner, [generatedName]: name },
    },
    spec: {
      // never refreshed: a new value would break what holds the old one
      refreshInterval: "0",
      target: { name: key },
      dataFrom: [
        {
          sourceRef: {
            generatorRef: {
              apiVersion: object.apiVersion,
              kind: object.kind,
              name: object.metadata.name,
            },
          },
        },
      ],
    },
  };
};

interface GeneratedSecret {
  // the Secret, and its key holding the value
  secret: string;
  property: string;
  // the section and key of the apps file
  app: string;
  key: string;
}

const generatedSecrets = (objects: Obj[]): GeneratedSecret[] =>
  objects
    .filter((o) => o.metadata?.annotations?.[generatedApp] !== undefined)
    .map((o) => {
      const { kind } = o.spec.dataFrom[0].sourceRef.generatorRef;
      const generator = Object.values(generators).find(
        (g) => g.object.kind === kind,
      )!;
      return {
        secret: o.metadata.name,
        property: generator.key,
        app: o.metadata.annotations[generatedApp],
        key: o.metadata.annotations[generatedName],
      };
    });

// sets each generated value in its app's section of the `apps` file, which fails if the file has
// that key already
const mergeTemplate = (generated: GeneratedSecret[]) =>
  [
    `{{- $apps := fromYaml (toString .${blobSecret}) -}}`,
    ...generated.flatMap(({ secret, app, key }, i) => [
      `{{- $s${i} := index $apps "${app}" -}}`,
      `{{- if not $s${i} }}{{ $s${i} = dict }}{{ $_ := set $apps "${app}" $s${i} }}{{ end -}}`,
      `{{- if hasKey $s${i} "${key}" }}{{ mustRegexMatch "( ${app}.${key} is generated, and in the apps file" "" }}{{ end -}}`,
      `{{- $_ := set $s${i} "${key}" (toString (index . "${secret}")) -}}`,
    ]),
    "{{ toYaml $apps }}",
  ].join("\n");

// builds the merged Secret, reading the others through `pushStore(esoNamespace)`
const mergedExternalSecret = (generated: GeneratedSecret[]): Obj => ({
  apiVersion: "external-secrets.io/v1",
  kind: "ExternalSecret",
  metadata: { name: mergedSecret, namespace: esoNamespace },
  spec: {
    refreshInterval: mergeRefreshInterval,
    secretStoreRef: { kind: "SecretStore", name: esoNamespace },
    target: {
      name: mergedSecret,
      template: {
        engineVersion: "v2",
        data: { [blobSecret]: mergeTemplate(generated) },
      },
    },
    data: [
      {
        secretKey: blobSecret,
        remoteRef: { key: blobSecret, property: blobSecret },
      },
      ...generated.map(({ secret, property }) => ({
        secretKey: secret,
        remoteRef: { key: secret, property },
      })),
    ],
  },
});

// the objects for the ESO app that merge what every app generates: made once all apps are built
export const mergeGenerated = (apps: ReadonlyMap<string, Obj[]>): Obj[] => [
  mergedExternalSecret(generatedSecrets([...apps.values()].flat())),
];

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

// a key of a Secret made from the apps file: a name is that key of the app's section. an object can
// read the section of another app (`from`), and name the Secret's key (`as`)
export type SecretEntry = string | { key: string; from?: string; as?: string };

// an entry's key in the Secret
export type EntryName<E extends SecretEntry> = E extends string
  ? E
  : E extends { as: infer A extends string }
    ? A
    : E extends { key: infer K extends string }
      ? K
      : never;

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

// copies keys of the apps file into a Secret (`from`: the section plain names are read from)
export const appSecrets = (
  app: string,
  name: string,
  entries: readonly SecretEntry[],
  { namespace = app, from = app }: SecretOptions = {},
): Obj[] => {
  const templates: Record<string, string> = {};
  for (const entry of entries) {
    const e = typeof entry === "string" ? { key: entry } : entry;
    const secretKey = e.as ?? e.key;
    if (secretKey in templates) {
      throw new Error(`the Secret ${name} has the key '${secretKey}' twice`);
    }
    templates[secretKey] = secretRef(e.key, e.from ?? from);
  }
  return [pushSecret({ name, namespace, templates })];
};

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
