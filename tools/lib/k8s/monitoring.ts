import { compact } from "../object.ts";
import type { Editor } from "./edit.ts";

type Obj = Record<string, any>;

export interface MonitorOptions {
  // the metrics path (default /metrics)
  path?: string;
  // how often to scrape; the prometheus default applies when unset
  interval?: string;
  // scrape over https, without verifying the certificate (in-cluster certificates are self-signed)
  https?: boolean;
  // keep the scraped labels where they clash with the target's own
  honorLabels?: boolean;
}

const endpoint = (port: string, opts: MonitorOptions) =>
  compact({
    port,
    path: opts.path,
    interval: opts.interval,
    honorLabels: opts.honorLabels,
    ...(opts.https && {
      scheme: "https",
      tlsConfig: { insecureSkipVerify: true },
    }),
  });

// a PodMonitor: scrapes the pods `selector` matches, on the container port named `port`. the
// namespace is the one it is added to
export const podMonitor = (
  name: string,
  selector: Record<string, string>,
  port: string,
  opts: MonitorOptions = {},
): Obj => ({
  apiVersion: "monitoring.coreos.com/v1",
  kind: "PodMonitor",
  metadata: { name },
  spec: {
    selector: { matchLabels: selector },
    podMetricsEndpoints: [endpoint(port, opts)],
  },
});

// a ServiceMonitor: scrapes the services `selector` matches (by label), on the service port named
// `port`. the namespace is the one it is added to
export const serviceMonitor = (
  name: string,
  selector: Record<string, string>,
  port: string,
  opts: MonitorOptions = {},
): Obj => ({
  apiVersion: "monitoring.coreos.com/v1",
  kind: "ServiceMonitor",
  metadata: { name },
  spec: {
    selector: { matchLabels: selector },
    endpoints: [endpoint(port, opts)],
  },
});

// labels that change as a chart is upgraded or installed, and so don't identify a service
const volatileLabels = [
  "app.kubernetes.io/managed-by",
  "app.kubernetes.io/version",
  "helm.sh/chart",
  "chart",
  "heritage",
];

export const stableLabels = (labels: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(labels).filter(([key]) => !volatileLabels.includes(key)),
  );

// a Service (made by `Workload.service`, or found in a source), which can be monitored
export class Service {
  private readonly obj: Obj;
  private readonly sink: (object: Obj) => void;

  constructor(obj: Obj, sink: (object: Obj) => void) {
    this.obj = obj;
    this.sink = sink;
  }

  // what a route can send traffic to, and what the service's tests read
  get kind(): string {
    return this.obj.kind;
  }
  get name(): string {
    return this.obj.metadata.name;
  }
  get metadata(): Obj {
    return this.obj.metadata;
  }
  get spec(): Obj {
    return this.obj.spec;
  }

  // scrapes the service's port named `port`. a service made here has no labels of its own for a
  // monitor to select it by, so it is given one; a found service is selected by the labels it has
  serviceMonitor(port: string, opts: MonitorOptions = {}): this {
    const ports: Obj[] = this.obj.spec.ports ?? [];
    if (!ports.some((p) => p.name === port)) {
      throw new Error(
        `service ${this.name} has no port named '${port}' (has: ${ports.map((p) => p.name).join(", ")})`,
      );
    }
    let selector = stableLabels(this.obj.metadata.labels ?? {});
    if (Object.keys(selector).length === 0) {
      const name = this.obj.spec.selector?.["app.kubernetes.io/name"];
      if (!name) {
        throw new Error(
          `service ${this.name} has no labels, and its selector has no app.kubernetes.io/name, to monitor it by`,
        );
      }
      selector = { "app.kubernetes.io/name": name };
      this.obj.metadata.labels = { ...this.obj.metadata.labels, ...selector };
    }
    this.sink(serviceMonitor(this.name, selector, port, opts));
    return this;
  }
}

// what `dashboard` edits a dashboard's ConfigMaps with. every operation fails when it matches
// nothing in any of them, so that a changed upstream is noticed
export interface DashboardEditor {
  // replaces text in the dashboards' json, everywhere it occurs. the text is literal
  replace(from: string, to: string): this;
  // removes the panels with these exact titles, wherever they are
  dropPanels(...titles: string[]): this;
  // removes the rows with these exact titles, and the panels in them
  dropRows(...titles: string[]): this;
  // removes whole dashboards: the files of the ConfigMaps with these names
  dropDashboards(...files: string[]): this;
}

// removes the panels (or the rows) with a title from a dashboard, returning how many. dashboards
// hold panels in a few shapes: a flat list (where a row is a panel that either holds its panels,
// or is followed by them), and the older `rows`
const prune = (node: Obj, title: string, rows: boolean): number => {
  let removed = 0;
  for (const key of ["panels", "rows"]) {
    const list: Obj[] | undefined = node[key];
    if (!Array.isArray(list)) {
      continue;
    }
    const kept: Obj[] = [];
    let skipping = false;
    for (const item of list) {
      const isRow = item.type === "row" || key === "rows";
      if (isRow) {
        skipping = false;
      }
      if (item.title === title && isRow === rows) {
        removed++;
        // an uncollapsed row's panels follow it
        skipping = isRow && key === "panels" && !item.panels?.length;
        continue;
      }
      if (skipping) {
        removed++;
        continue;
      }
      removed += prune(item, title, rows);
      kept.push(item);
    }
    node[key] = kept;
  }
  return removed;
};

// edits the dashboards of ConfigMaps (the kind grafana's sidecar loads), once an app is built: a
// `postRender` hook gives `e`
export const dashboard = (
  e: Editor,
  names: string | string[],
  edit: (d: DashboardEditor) => void,
): void => {
  const maps = [names]
    .flat()
    .map((name) => e.find({ kind: "ConfigMap", name }));
  const label = [names].flat().join(", ");

  const files = () =>
    maps.flatMap((map) =>
      Object.keys(map.data ?? {}).map((file) => ({ map, file })),
    );
  const matched = (count: number, what: string) => {
    if (count === 0) {
      throw new Error(`${what} matches nothing in the dashboards of ${label}`);
    }
  };
  const drop = (titles: string[], rows: boolean) => {
    for (const title of titles) {
      let count = 0;
      for (const { map, file } of files()) {
        const parsed = JSON.parse(map.data[file]);
        const removed = prune(parsed, title, rows);
        if (removed > 0) {
          map.data[file] = JSON.stringify(parsed, null, 2);
          count += removed;
        }
      }
      matched(count, `${rows ? "dropRows" : "dropPanels"} '${title}'`);
    }
  };

  const d: DashboardEditor = {
    replace(from, to) {
      let count = 0;
      for (const { map, file } of files()) {
        const text: string = map.data[file];
        count += text.split(from).length - 1;
        map.data[file] = text.replaceAll(from, () => to);
      }
      matched(count, `replace '${from}'`);
      return d;
    },
    dropPanels(...titles) {
      drop(titles, false);
      return d;
    },
    dropRows(...titles) {
      drop(titles, true);
      return d;
    },
    dropDashboards(...names) {
      for (const name of names) {
        const found = files().filter(({ file }) => file === name);
        matched(found.length, `dropDashboards '${name}'`);
        for (const { map } of found) {
          delete map.data[name];
        }
      }
      return d;
    },
  };

  edit(d);
};

// a ConfigMap grafana's sidecar loads for each dashboard of a mixin ({ "file.json": dashboard }),
// placed in the grafana folder `folder`. named `dashboard--<file>`, which `dashboard` edits them by
export const dashboardConfigMaps = (
  folder: string,
  dashboards: Record<string, unknown>,
): Obj[] =>
  Object.entries(dashboards).map(([file, dashboard]) => ({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `dashboard--${file.replace(/[._]/g, "-")}`,
      labels: { grafana_dashboard: "1" },
      annotations: { grafana_folder: folder },
    },
    data: { [file]: JSON.stringify(dashboard) },
  }));

// a PrometheusRule for each group of a mixin's rules or alerts, named `<kind>--<group>`
export const prometheusRules = (
  kind: "alert" | "rule",
  groups: Record<string, any>[],
): Obj[] =>
  groups.map((group) => ({
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: { name: `${kind}--${group.name.replace(/[._]/g, "-")}` },
    spec: { groups: [group] },
  }));
