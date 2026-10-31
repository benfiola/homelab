type Obj = Record<string, any>;

// everything that ties an app to vault. the contract apps rely on: `appSecrets(app)` produces a Secret
// named 'secrets' in the app's namespace, holding the keys at vault path `<app>`.

// the Secret the helpers produce unless told otherwise
export const secretName = "secrets";

export interface AuthOptions {
  // the vault role to authenticate as; also names the VaultAuth
  role: string;
  // the service account vault authenticates; defaults to the one the operator expects
  serviceAccount?: string;
}

export interface Auth {
  name: string;
  objects: Obj[];
}

// a service account, and the VaultAuth that binds it to a vault role
export const vaultAuth = ({
  role,
  serviceAccount = "vault-secrets-operator",
}: AuthOptions): Auth => ({
  name: role,
  objects: [
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: serviceAccount },
    },
    {
      apiVersion: "secrets.hashicorp.com/v1beta1",
      kind: "VaultAuth",
      metadata: { name: role },
      spec: {
        kubernetes: { role, serviceAccount },
        method: "kubernetes",
        mount: "kubernetes",
      },
    },
  ],
});

export interface SecretOptions {
  auth: Auth;
  // the Secret to create (default: 'secrets')
  name?: string;
  // the vault path to read
  path: string;
}

// copies the keys at a vault path into a Secret, unchanged
export const vaultStaticSecret = ({
  auth,
  name = secretName,
  path,
}: SecretOptions): Obj => ({
  apiVersion: "secrets.hashicorp.com/v1beta1",
  kind: "VaultStaticSecret",
  metadata: { name },
  spec: {
    destination: { create: true, name },
    mount: "secrets",
    path,
    type: "kv-v2",
    vaultAuthRef: auth.name,
  },
});

// refers to a key stored at the vault path, inside a template
export const secretRef = (key: string) =>
  `{{ get (get .Secrets "data") "${key}" }}`;

export interface TemplatedSecretOptions extends SecretOptions {
  // Secret keys, mapped to templates (use `secretRef` to read vault keys)
  templates: Record<string, string>;
}

// builds a Secret's keys from templates over the keys at a vault path
export const vaultTemplatedSecret = ({
  auth,
  name = secretName,
  path,
  templates,
}: TemplatedSecretOptions): Obj => ({
  apiVersion: "secrets.hashicorp.com/v1beta1",
  kind: "VaultDynamicSecret",
  metadata: { name },
  spec: {
    destination: {
      create: true,
      name,
      transformation: {
        templates: Object.fromEntries(
          Object.entries(templates).map(([key, text]) => [key, { text }]),
        ),
      },
    },
    mount: "secrets",
    path: `data/${path}`,
    vaultAuthRef: auth.name,
  },
});

// an app reading its own vault path (named after the app) into a Secret named 'secrets'
export const appSecrets = (app: string): Obj[] => {
  const auth = vaultAuth({ role: app });
  return [...auth.objects, vaultStaticSecret({ auth, path: app })];
};

// the same, but the Secret's keys are built from templates over the app's vault keys
export const appTemplatedSecrets = (
  app: string,
  templates: Record<string, string>,
): Obj[] => {
  const auth = vaultAuth({ role: app });
  return [
    ...auth.objects,
    vaultTemplatedSecret({ auth, path: app, templates }),
  ];
};

// bucket-sync reads its backblaze credentials from vault with its own role and service account
export const bucketSyncAuth = (): Auth =>
  vaultAuth({
    role: "bucket-sync",
    serviceAccount: "bucket-sync-vault-secrets-operator",
  });

// the Secret bucket-sync reads for a bucket's sync policy
export const bucketSyncSecret = (auth: Auth, bucket: string): Obj =>
  vaultStaticSecret({
    auth,
    name: `bucket-sync-${bucket}`,
    path: "bucket-sync",
  });
