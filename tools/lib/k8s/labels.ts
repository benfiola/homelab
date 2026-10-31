type Obj = Record<string, any>;

interface Path {
  path: string;
  // create the path when the object doesn't have it yet
  create: boolean;
}

const at = (path: string, create = false): Path => ({ path, create });

const podAffinity = (root: string) =>
  ["podAffinity", "podAntiAffinity"].flatMap((kind) => [
    at(
      `${root}/affinity/${kind}/preferredDuringSchedulingIgnoredDuringExecution/podAffinityTerm/labelSelector/matchLabels`,
    ),
    at(
      `${root}/affinity/${kind}/requiredDuringSchedulingIgnoredDuringExecution/labelSelector/matchLabels`,
    ),
  ]);

const workload = (extra: Path[] = []): Path[] => [
  at("spec/selector/matchLabels", true),
  at("spec/template/metadata/labels", true),
  ...podAffinity("spec/template/spec"),
  ...extra,
];

// fields besides `metadata.labels` that get a label, per kind: selectors and pod templates, so that
// what a label selects still matches
const fields: Record<string, Path[]> = {
  Service: [at("spec/selector", true)],
  ReplicationController: [
    at("spec/selector", true),
    at("spec/template/metadata/labels", true),
  ],
  Deployment: workload(),
  ReplicaSet: workload(),
  DaemonSet: workload(),
  StatefulSet: workload([
    at("spec/volumeClaimTemplates/metadata/labels", true),
  ]),
  Job: [at("spec/template/metadata/labels", true)],
  CronJob: [
    at("spec/jobTemplate/metadata/labels", true),
    at("spec/jobTemplate/spec/template/metadata/labels", true),
  ],
  PodDisruptionBudget: [at("spec/selector/matchLabels")],
  NetworkPolicy: [
    at("spec/podSelector/matchLabels"),
    at("spec/ingress/from/podSelector/matchLabels"),
    at("spec/egress/to/podSelector/matchLabels"),
  ],
};

const merge = (
  node: any,
  segments: string[],
  pairs: Record<string, string>,
  create: boolean,
) => {
  if (Array.isArray(node)) {
    node.forEach((item) => merge(item, segments, pairs, create));
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    if (node[head] !== undefined && node[head] !== null) {
      Object.assign(node[head], pairs);
    } else if (create) {
      node[head] = { ...pairs };
    }
    return;
  }
  if ((node[head] === undefined || node[head] === null) && create) {
    node[head] = {};
  }
  merge(node[head], rest, pairs, create);
};

// adds labels to an object, and to the selectors that match pods by label (only the kinds above)
export const addLabels = (obj: Obj, pairs: Record<string, string>): Obj => {
  merge(obj, ["metadata", "labels"], pairs, true);
  for (const { path, create } of fields[obj.kind] ?? []) {
    merge(obj, path.split("/"), pairs, create);
  }
  return obj;
};
