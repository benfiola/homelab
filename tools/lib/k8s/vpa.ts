type Obj = Record<string, any>;

const workloadKinds = ["Deployment", "StatefulSet", "DaemonSet"];

export interface Target {
  kind: string;
  name: string;
  // required for targets that aren't a Deployment, StatefulSet or DaemonSet
  apiVersion?: string;
}

export interface Options {
  // recommend only: never evict or resize
  advisory?: boolean;
  namespace?: string;
}

// a VerticalPodAutoscaler for a workload, resizing pods in place where it can
export const vpa = (target: Target, opts: Options = {}): Obj => {
  const apiVersion = workloadKinds.includes(target.kind)
    ? "apps/v1"
    : target.apiVersion;
  return {
    apiVersion: "autoscaling.k8s.io/v1",
    kind: "VerticalPodAutoscaler",
    metadata: {
      name: target.name,
      ...(opts.namespace && { namespace: opts.namespace }),
    },
    spec: {
      targetRef: { apiVersion, kind: target.kind, name: target.name },
      updatePolicy: { updateMode: opts.advisory ? "Off" : "InPlaceOrRecreate" },
    },
  };
};
