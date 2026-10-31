#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { parse, parseAllDocuments } from "yaml";
import { exit, run } from "./lib/cli.ts";
import { align } from "./lib/table.ts";
import { parseWith, z } from "./lib/schema.ts";

// compares two rendered manifest trees object by object: the golden-master check for the migration.
// self-contained, so it can be deleted with its test afterwards.

type Obj = Record<string, any>;

// ---- diffing ----------------------------------------------------------------------------

// "expected" is the reference; "actual" is the new render.
//   removed: present in expected, missing from actual
//   added:   missing from expected, present in actual
export interface FieldDiff {
  pointer: string;
  type: "added" | "removed" | "changed";
  expected?: unknown;
  actual?: unknown;
}

const escape = (segment: string) =>
  segment.replace(/~/g, "~0").replace(/\//g, "~1");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// json pointer (rfc 6901) diff between two values. arrays are compared by index.
export const diffValues = (
  expected: unknown,
  actual: unknown,
  pointer = "",
): FieldDiff[] => {
  if (isRecord(expected) && isRecord(actual)) {
    const diffs: FieldDiff[] = [];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      const child = `${pointer}/${escape(key)}`;
      if (!(key in actual)) {
        diffs.push({
          pointer: child,
          type: "removed",
          expected: expected[key],
        });
      } else if (!(key in expected)) {
        diffs.push({ pointer: child, type: "added", actual: actual[key] });
      } else {
        diffs.push(...diffValues(expected[key], actual[key], child));
      }
    }
    return diffs;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const diffs: FieldDiff[] = [];
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i++) {
      const child = `${pointer}/${i}`;
      if (i >= actual.length) {
        diffs.push({ pointer: child, type: "removed", expected: expected[i] });
      } else if (i >= expected.length) {
        diffs.push({ pointer: child, type: "added", actual: actual[i] });
      } else {
        diffs.push(...diffValues(expected[i], actual[i], child));
      }
    }
    return diffs;
  }

  if (expected === actual) {
    return [];
  }
  return [{ pointer, type: "changed", expected, actual }];
};

// true if `pointer` is `prefix` or beneath it (segment-aware).
const pointerWithin = (pointer: string, prefix: string) =>
  pointer === prefix || pointer.startsWith(`${prefix}/`);

// ---- loading ----------------------------------------------------------------------------

interface LoadedObject {
  key: string;
  obj: Obj;
  file: string;
}

type AppObjects = Map<string, LoadedObject>;

// identifies an object by api group (not version), kind, namespace and name.
// ignoring the version means a version bump is reported as a changed field
// instead of an unrelated remove + add.
const objectKey = (obj: Obj) => {
  const apiVersion: string = obj.apiVersion ?? "";
  const group = apiVersion.includes("/") ? apiVersion.split("/")[0] : "";
  const namespace = obj.metadata?.namespace ?? "";
  const name = obj.metadata?.name ?? "";
  return `${group}/${obj.kind}/${namespace}/${name}`;
};

const keyParts = (key: string) => {
  const [group, kind, namespace, name] = key.split("/");
  return { group, kind, namespace, name };
};

// an explicit null in a map is the same as an absent field to the api server. null array elements stay.
const dropNulls = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(dropNulls);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNulls(v)]),
    );
  }
  return value;
};

// json with sorted keys, to order values by content
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    isRecord(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );

// the rules of a cilium policy are a set: they allow, and the order they are written in means
// nothing. so they are put in a fixed order, and policies that differ only in it are equal.
const policyKinds = new Set([
  "CiliumClusterwideNetworkPolicy",
  "CiliumNetworkPolicy",
]);
const sortRules = (obj: Obj) => {
  for (const direction of ["ingress", "egress", "ingressDeny", "egressDeny"]) {
    if (Array.isArray(obj.spec?.[direction])) {
      obj.spec[direction] = [...obj.spec[direction]].sort((a, b) =>
        canonical(a).localeCompare(canonical(b)),
      );
    }
  }
};

// removes fields that are runtime state and never part of the desired state, and
// treats null fields as absent (except in crds, where schemas can say `default: null`).
const normalize = (obj: Obj): Obj => {
  const copy =
    obj.kind === "CustomResourceDefinition"
      ? structuredClone(obj)
      : dropNulls(obj);
  delete copy.status;
  if (policyKinds.has(copy.kind)) {
    sortRules(copy);
  }
  if (copy.metadata) {
    delete copy.metadata.creationTimestamp;
    delete copy.metadata.managedFields;
  }
  return copy;
};

const walk = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
    ) {
      files.push(path);
    }
  }
  return files.sort();
};

// loads every kubernetes object beneath `dir`.
// documents that are not kubernetes objects (e.g. a kustomization.yaml with no
// apiVersion/kind) and kustomize config files are skipped.
const loadObjects = (dir: string): AppObjects => {
  const objects: AppObjects = new Map();
  for (const file of walk(dir)) {
    for (const doc of parseAllDocuments(readFileSync(file, "utf-8"))) {
      if (doc.errors.length > 0) {
        throw new Error(`${file}: ${doc.errors[0].message}`);
      }
      const obj = doc.toJSON();
      if (!obj || typeof obj !== "object" || !obj.apiVersion || !obj.kind) {
        continue;
      }
      if (String(obj.apiVersion).startsWith("kustomize.config.k8s.io/")) {
        continue;
      }
      const key = objectKey(obj);
      const existing = objects.get(key);
      if (existing) {
        throw new Error(
          `duplicate object ${key} in ${file} (first defined in ${existing.file})`,
        );
      }
      objects.set(key, { key, obj: normalize(obj), file });
    }
  }
  return objects;
};

interface LoadAppsOpts {
  // also load <root>/flux (written by `flux bootstrap`, not by the render) as '@flux'
  flux?: boolean;
}

// an "app" is a direct child of <root>/apps.
const loadApps = (
  root: string,
  opts: LoadAppsOpts = {},
): Map<string, AppObjects> => {
  const apps = new Map<string, AppObjects>();

  const appsDir = join(root, "apps");
  const names = readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    apps.set(name, loadObjects(join(appsDir, name)));
  }

  if (opts.flux) {
    apps.set("@flux", loadObjects(join(root, "flux")));
  }

  return apps;
};

// ---- comparing --------------------------------------------------------------------------

// changing these fields on an existing object is rejected by the api server, or
// forces the object to be recreated (downtime, and data loss for storage).
const immutableFields: { group: string; kind: string; pointers: string[] }[] = [
  { group: "apps", kind: "Deployment", pointers: ["/spec/selector"] },
  { group: "apps", kind: "DaemonSet", pointers: ["/spec/selector"] },
  { group: "apps", kind: "ReplicaSet", pointers: ["/spec/selector"] },
  {
    group: "apps",
    kind: "StatefulSet",
    pointers: [
      "/spec/selector",
      "/spec/serviceName",
      "/spec/podManagementPolicy",
      "/spec/volumeClaimTemplates",
    ],
  },
  {
    group: "batch",
    kind: "Job",
    pointers: ["/spec/selector", "/spec/template"],
  },
  {
    group: "",
    kind: "PersistentVolumeClaim",
    pointers: [
      "/spec/accessModes",
      "/spec/selector",
      "/spec/storageClassName",
      "/spec/volumeMode",
      "/spec/volumeName",
    ],
  },
  {
    group: "",
    kind: "Service",
    pointers: ["/spec/clusterIP", "/spec/clusterIPs"],
  },
];

// removing these deletes data (or everything that depends on them) when pruned.
const destructiveKinds = new Set([
  "CustomResourceDefinition",
  "Namespace",
  "PersistentVolume",
  "PersistentVolumeClaim",
  "StatefulSet",
]);

export type Severity = "normal" | "immutable" | "destructive";

export interface Finding extends FieldDiff {
  app: string;
  object: string;
  severity: Severity;
  allowedBy?: Allowance;
}

export interface Allowance {
  app: string;
  object: string;
  path?: string;
  type?: FieldDiff["type"];
  reason: string;
  used: number;
}

export interface Result {
  apps: { name: string; objects: number; findings: Finding[] }[];
  unexpected: Finding[];
  stale: Allowance[];
}

const allowanceFile = z.strictObject({
  allow: z
    .array(
      z.strictObject({
        app: z.string().min(1),
        object: z.string().min(1),
        path: z.string().optional(),
        type: z.enum(["added", "removed", "changed"]).optional(),
        reason: z.string().min(1),
      }),
    )
    .default([]),
});

export const loadAllowances = (file: string): Allowance[] =>
  parseWith(
    allowanceFile,
    parse(readFileSync(file, "utf-8")) ?? {},
    file,
  ).allow.map((entry) => ({ ...entry, used: 0 }));

const severityOf = (object: string, diff: FieldDiff): Severity => {
  const { group, kind } = keyParts(object);

  if (diff.pointer === "" && diff.type === "removed") {
    return destructiveKinds.has(kind) ? "destructive" : "normal";
  }

  const rule = immutableFields.find(
    (r) => r.group === group && r.kind === kind,
  );
  if (rule?.pointers.some((p) => pointerWithin(diff.pointer, p))) {
    return "immutable";
  }
  return "normal";
};

const compareApp = (
  app: string,
  expected: AppObjects,
  actual: AppObjects,
): Finding[] => {
  const findings: Finding[] = [];
  const add = (object: string, diff: FieldDiff) =>
    findings.push({ app, object, severity: severityOf(object, diff), ...diff });

  const keys = new Set([...expected.keys(), ...actual.keys()]);
  for (const key of [...keys].sort()) {
    const e = expected.get(key);
    const a = actual.get(key);
    if (e && !a) {
      add(key, { pointer: "", type: "removed", expected: e.obj });
    } else if (!e && a) {
      add(key, { pointer: "", type: "added", actual: a.obj });
    } else if (e && a) {
      for (const diff of diffValues(e.obj, a.obj)) {
        add(key, diff);
      }
    }
  }
  return findings;
};

const matches = (a: Allowance, f: Finding) => {
  if (a.app !== f.app || a.object !== f.object) {
    return false;
  }
  if (a.type && a.type !== f.type) {
    return false;
  }
  if (a.path === undefined || a.path === "") {
    // an allowance without a path covers the whole object (whole-object
    // add/remove, or every field of it)
    return true;
  }
  return pointerWithin(f.pointer, a.path);
};

export interface CompareOpts {
  allowances?: Allowance[];
  apps?: string[];
  flux?: boolean;
}

export const compare = (
  expectedRoot: string,
  actualRoot: string,
  opts: CompareOpts = {},
): Result => {
  const allowances = opts.allowances ?? [];
  const filter = new Set(opts.apps ?? []);

  const expectedApps = loadApps(expectedRoot, { flux: opts.flux });
  const actualApps = loadApps(actualRoot, { flux: opts.flux });

  const names = [...new Set([...expectedApps.keys(), ...actualApps.keys()])]
    .filter((n) => filter.size === 0 || filter.has(n))
    .sort();

  const apps: Result["apps"] = [];
  for (const name of names) {
    const expected = expectedApps.get(name) ?? new Map();
    const actual = actualApps.get(name) ?? new Map();
    const findings = compareApp(name, expected, actual);

    for (const finding of findings) {
      const allowance = allowances.find((a) => matches(a, finding));
      if (allowance) {
        allowance.used++;
        finding.allowedBy = allowance;
      }
    }
    apps.push({ name, objects: expected.size, findings });
  }

  // allowances for apps outside the filter can't be judged
  const stale = allowances.filter(
    (a) => a.used === 0 && (filter.size === 0 || filter.has(a.app)),
  );
  const unexpected = apps.flatMap((a) =>
    a.findings.filter((f) => !f.allowedBy),
  );
  return { apps, unexpected, stale };
};

// ---- command ----------------------------------------------------------------------------

const show = (value: unknown) => {
  if (value === undefined) {
    return "<none>";
  }
  const text = JSON.stringify(value);
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
};

const describeFinding = (f: Finding) => {
  const tag = f.severity === "normal" ? "" : ` [${f.severity.toUpperCase()}]`;
  if (f.pointer === "") {
    const verb =
      f.type === "removed" ? "missing from actual" : "extra in actual";
    return `${f.type === "removed" ? "-" : "+"} ${f.object} (${verb})${tag}`;
  }
  if (f.type === "removed") {
    return `~ ${f.object} ${f.pointer}: ${show(f.expected)} -> <removed>${tag}`;
  }
  if (f.type === "added") {
    return `~ ${f.object} ${f.pointer}: <none> -> ${show(f.actual)}${tag}`;
  }
  return `~ ${f.object} ${f.pointer}: ${show(f.expected)} -> ${show(f.actual)}${tag}`;
};

interface Options {
  allow?: string;
  app?: string;
  flux?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

const program = new Command()
  .name("parity")
  .description(
    "compares the kubernetes objects of two rendered manifest trees, app by app. each has an apps/<name>/ directory per app, and optionally flux/.",
  )
  .argument("<expected>", "the reference tree (e.g. ./golden/manifests)")
  .argument("<actual>", "the new render")
  .option(
    "--allow <file>",
    "file of accepted differences (default: parity.allow.yaml, if present)",
  )
  .option("--app <names>", "comma-separated apps to compare (default: all)")
  .option(
    "--flux",
    "also compare <dir>/flux (written by `flux bootstrap`; not part of the render)",
  )
  .option("--quiet", "only print apps with unexpected differences")
  .option("--verbose", "also print accepted differences")
  .action((expected: string, actual: string, o: Options) => {
    for (const dir of [expected, actual]) {
      if (!existsSync(dir)) {
        throw new Error(`no such directory: ${dir}`);
      }
    }

    const allowFile =
      o.allow ??
      (existsSync("parity.allow.yaml") ? "parity.allow.yaml" : undefined);
    const allowances = allowFile ? loadAllowances(allowFile) : [];

    const result = compare(expected, actual, {
      allowances,
      apps: o.app?.split(",").filter(Boolean),
      flux: o.flux,
    });

    const shown = result.apps
      .map((app) => ({
        app,
        unexpected: app.findings.filter((f) => !f.allowedBy),
        allowed: app.findings.filter((f) => f.allowedBy),
      }))
      .filter(({ unexpected }) => unexpected.length > 0 || !o.quiet);
    const lines = align(
      shown.map(({ app, unexpected, allowed }) => [
        unexpected.length === 0 ? "ok" : "FAIL",
        app.name,
        `${app.objects} objects`,
        allowed.length > 0 ? `${allowed.length} accepted` : "",
      ]),
      { right: [2] },
    );
    shown.forEach(({ unexpected, allowed }, i) => {
      console.log(lines[i]);
      for (const f of unexpected) {
        console.log(`    ${describeFinding(f)}`);
      }
      if (o.verbose) {
        for (const f of allowed) {
          console.log(
            `    (accepted) ${describeFinding(f)} -- ${f.allowedBy!.reason}`,
          );
        }
      }
    });

    for (const a of result.stale) {
      console.log(
        `STALE allowance (matches nothing): app=${a.app} object=${a.object}${a.path ? ` path=${a.path}` : ""} -- ${a.reason}`,
      );
    }

    const failing = new Set(result.unexpected.map((f) => f.app)).size;
    console.log(
      `\n${result.apps.length} apps compared: ${result.apps.length - failing} ok, ${failing} with differences; ` +
        `${result.unexpected.length} unexpected, ${result.stale.length} stale allowances`,
    );
    exit(result.unexpected.length === 0 && result.stale.length === 0 ? 0 : 1);
  });

if (import.meta.main) {
  await run(program);
}
