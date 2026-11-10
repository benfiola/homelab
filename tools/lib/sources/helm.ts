import { join } from "node:path";
import { capture, withTempFile } from "../exec.ts";
import { toYaml } from "../yaml.ts";
import { cacheDir, cachedDir } from "./cache.ts";
import { parseManifests } from "./manifest.ts";

type Obj = Record<string, any>;

// charts are rendered against this kubernetes version, so a render doesn't depend on the
// cluster (or tool) it runs against
export const kubeVersion = "1.34.0";

// the monitors the cluster's prometheus operator provides. charts check for these before they
// render their own monitors, and a render has no cluster to ask
const apiVersions = [
  "monitoring.coreos.com/v1",
  "monitoring.coreos.com/v1/PodMonitor",
  "monitoring.coreos.com/v1/ServiceMonitor",
];

export interface HelmOptions {
  // where the chart is published: a repository url, or an `oci://` registry path
  repo: string;
  chart: string;
  version: string;
  // defaults to the chart's name
  release?: string;
  // the chart's values
  values?: Obj;
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
const pull = ({ repo, chart, version }: HelmOptions): Promise<string> =>
  cachedDir(
    cacheDir("charts", slug(repo), `${chart}-${version}`),
    async (work) => {
      const source = repo.startsWith("oci://")
        ? [`${repo.replace(/\/$/, "")}/${chart}`]
        : [chart, "--repo", repo];
      await capture(
        "helm",
        [
          "pull",
          ...source,
          "--version",
          version,
          "--untar",
          "--untardir",
          work,
        ],
        { context: `helm pull ${chart} ${version} (${repo})` },
      );
      return join(work, chart);
    },
  );

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
  const base = [
    "template",
    opts.release ?? opts.chart,
    dir,
    "--namespace",
    namespace,
    "--kube-version",
    opts.kubeVersion ?? kubeVersion,
    "--skip-tests",
    ...apiVersions.flatMap((v) => ["--api-versions", v]),
    ...(opts.crds === false ? [] : ["--include-crds"]),
  ];
  const template = (extra: string[]) =>
    capture("helm", [...base, ...extra], {
      context: `helm template ${opts.chart}`,
    });
  let stdout: string;
  if (opts.values) {
    stdout = await withTempFile("values.yaml", toYaml([opts.values]), (file) =>
      template(["--values", file]),
    );
  } else {
    stdout = await template([]);
  }
  return parseManifests(stdout, `helm template ${opts.chart}`).filter(
    (obj) => !isDeleteHook(obj),
  );
};
