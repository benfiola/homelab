import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { cacheDir } from "../cache.ts";
import { parseManifests } from "./manifest.ts";

const run = promisify(execFile);

type Obj = Record<string, any>;

// charts are rendered against this kubernetes version, so a render doesn't depend on the
// cluster (or tool) it runs against
export const kubeVersion = "1.34.0";

export interface HelmOptions {
  // where the chart is published: a repository url, or an `oci://` registry path
  repo: string;
  chart: string;
  version: string;
  // defaults to the chart's name
  release?: string;
  // absolute paths of values files, in order
  values?: string[];
  // include the chart's crds (default true)
  crds?: boolean;
  kubeVersion?: string;
}

// a chart is written `<repository url>/<chart>?version=<version>`, or an `oci://` path:
//   oci://quay.io/jetstack/charts/cert-manager?version=v1.21.3
//   https://helm.cilium.io/cilium?version=1.20.1
// the second is not a real url (helm has none for a chart in a repository): it is the repository's
// url with the chart's name added.
export const parseChartUrl = (
  url: string,
): Pick<HelmOptions, "repo" | "chart" | "version"> => {
  const query = url.indexOf("?");
  const location = query < 0 ? url : url.slice(0, query);
  const params = new URLSearchParams(query < 0 ? "" : url.slice(query + 1));
  const version = params.get("version");
  const slash = location.lastIndexOf("/");
  if (
    !/^(oci|https?):\/\/[^/]+\/.+/.test(location) ||
    !version ||
    [...params.keys()].some((key) => key !== "version")
  ) {
    throw new Error(
      `${url}: expected '<repository url>/<chart>?version=<version>'`,
    );
  }
  return {
    repo: location.slice(0, slash),
    chart: location.slice(slash + 1),
    version,
  };
};

const slug = (repo: string) =>
  repo
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[^a-zA-Z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");

// cached by repository, name and version: a published version never changes
const pull = async ({ repo, chart, version }: HelmOptions): Promise<string> => {
  const dest = cacheDir("charts", slug(repo), `${chart}-${version}`);
  if (existsSync(dest)) {
    return dest;
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  const temp = mkdtempSync(join(dest, "..", ".pull-"));
  try {
    const source = repo.startsWith("oci://")
      ? [`${repo.replace(/\/$/, "")}/${chart}`]
      : [chart, "--repo", repo];
    await run("helm", [
      "pull",
      ...source,
      "--version",
      version,
      "--untar",
      "--untardir",
      temp,
    ]);
    try {
      renameSync(join(temp, chart), dest);
    } catch (e: any) {
      // a concurrent build pulled the same chart first, which is fine
      if (!existsSync(dest)) {
        throw e;
      }
    }
  } catch (e: any) {
    throw new Error(
      `helm pull ${chart} ${version} (${repo}): ${String(e.stderr || e.message).trim()}`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return dest;
};

const deleteHooks = new Set(["pre-delete", "post-delete"]);

// true if the object is a helm hook that only runs on delete
export const isDeleteHook = (obj: Obj) => {
  const annotation = obj.metadata?.annotations?.["helm.sh/hook"];
  if (!annotation) {
    return false;
  }
  const types = String(annotation)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return types.length > 0 && types.every((t) => deleteHooks.has(t));
};

// the objects a chart renders to. flux applies manifests, so helm's lifecycle isn't respected:
// a delete hook would run every time its manifest is re-applied, so objects that are only
// delete hooks are dropped.
export const helm = async (
  opts: HelmOptions,
  namespace: string,
): Promise<Obj[]> => {
  const dir = await pull(opts);
  const args = [
    "template",
    opts.release ?? opts.chart,
    dir,
    "--namespace",
    namespace,
    "--kube-version",
    opts.kubeVersion ?? kubeVersion,
    "--skip-tests",
    ...(opts.crds === false ? [] : ["--include-crds"]),
    ...(opts.values ?? []).flatMap((file) => ["--values", file]),
  ];
  let stdout: string;
  try {
    ({ stdout } = await run("helm", args, { maxBuffer: 1024 * 1024 * 1024 }));
  } catch (e: any) {
    throw new Error(
      `helm template ${opts.chart}: ${String(e.stderr || e.message).trim()}`,
    );
  }
  return parseManifests(stdout, `helm template ${opts.chart}`).filter(
    (obj) => !isDeleteHook(obj),
  );
};
