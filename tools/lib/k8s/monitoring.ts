import { compact } from "../object.ts";

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
