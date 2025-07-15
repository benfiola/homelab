import { ApiObject, App as BaseApp } from "cdk8s";
import {
  CronJob,
  DaemonSet,
  Deployment,
  Job,
  Pod,
  StatefulSet,
} from "../resources/k8s/k8s";
import { getPodLabels } from "./getPodLabels";
import { getPodRequests } from "./getPodRequests";

interface BaseResource {
  GVK: {
    apiVersion: string;
    kind: string;
  };
}

/**
 * Type guard guaranteeing that an object is an instance of the provided ApiObject class-ish (`BaseResource`).
 *
 * @param cls the class-ish
 * @param obj the object
 * @returns true if `obj` is an instance of `cls`, false otherwise
 */
const isResource = <ResourceCls extends BaseResource>(
  cls: ResourceCls,
  obj: any
): obj is ResourceCls => {
  return (
    ApiObject.isApiObject(obj) &&
    obj.apiVersion == cls.GVK.apiVersion &&
    obj.kind == cls.GVK.kind
  );
};

const k8sApiGroups = new Set([
  "core",
  "admissionregistration.k8s.io",
  "apiextensions.k8s.io",
  "apps",
  "authentication.k8s.io",
  "authorization.k8s.io",
  "autoscaling",
  "batch",
  "certificates.k8s.io",
  "coordination.k8s.io",
  "discovery.k8s.io",
  "events.k8s.io",
  "flowcontrol.apiserver.k8s.io",
  "networking.k8s.io",
  "node.k8s.io",
  "policy",
  "rbac.authorization.k8s.io",
  "scheduling.k8s.io",
  "storage.k8s.io",
]);

export class App extends BaseApp {
  synth() {
    this.finalize();
    super.synth();
  }

  synthYaml() {
    this.finalize();
    return super.synthYaml();
  }

  finalize() {
    for (const obj of this.node.findAll()) {
      if (!ApiObject.isApiObject(obj)) {
        continue;
      }
      this.addPodLabels(obj);
      this.defineDefaultResources(obj);
      this.ensureDefaultPodSecurity(obj);
      this.removeHelmTest(obj);
      this.setArgocdSkipDryRunOnMissingResource(obj);
      this.setArgocdServerSideApply(obj);
    }
  }

  /**
   * Defining network policies require pods to have a consistent label.
   *
   * This method will ensure that pods originating from a helm chart are all labelled appropriately.
   *
   * @param obj the api resource to modify
   * @returns void
   */
  addPodLabels(obj: ApiObject) {
    const props = (obj as any).props;
    const podName = obj.metadata.name!;

    // extract pod from object
    let pod: any;
    if (
      isResource(DaemonSet, obj) ||
      isResource(Deployment, obj) ||
      isResource(StatefulSet, obj) ||
      isResource(Job, obj)
    ) {
      pod = props.spec.template;
    } else if (isResource(CronJob, obj)) {
      throw new Error("not implemented");
    } else if (isResource(Pod, obj)) {
      pod = props;
    } else {
      return;
    }

    // attach pod labels to pods
    pod.metadata.labels = {
      ...getPodLabels(podName),
      ...(pod?.metadata?.labels || {}),
    };
  }

  /**
   * Attaches default requests/limits to all pods in a helm chart (if not already defined).
   *
   * @param obj the api resource to modify
   * @returns void
   */
  defineDefaultResources(obj: ApiObject) {
    const props = (obj as any).props;

    // extract pod from object
    let pod;
    if (
      isResource(DaemonSet, obj) ||
      isResource(Deployment, obj) ||
      isResource(StatefulSet, obj) ||
      isResource(Job, obj)
    ) {
      pod = props.spec.template;
    } else if (isResource(CronJob, obj)) {
      throw new Error("not implemented");
    } else if (isResource(Pod, obj)) {
      pod = props;
    } else {
      return;
    }

    // collect containers
    const containers = [
      ...(pod.spec.initContainers || []),
      ...pod.spec.containers,
    ];

    // attach resource requests/limits to containers
    const defaults = getPodRequests();
    for (const container of containers) {
      // use defaults
      let requests: Record<string, string> = defaults.requests;
      let limits: Record<string, string> = defaults.limits;
      if (container?.resources?.requests !== undefined) {
        // if requests are defined, use them
        requests = container.resources.requests;
        // use defined requests over default limits, but remove cpu limits
        limits = { ...requests };
        if (container?.resources?.limits !== undefined) {
          // if provided, use defined limits
          limits = container.resources.limits;
        }
        delete limits["cpu"];
      }
      container.resources = { requests, limits };
    }
  }

  /**
   * Ensures fields required by PodSecurity are set if missing
   *
   * @param obj the api resource to modify
   * @returns void
   */
  ensureDefaultPodSecurity(obj: ApiObject) {
    const props = (obj as any).props;

    // extract pod from object
    let pod;
    if (
      isResource(DaemonSet, obj) ||
      isResource(Deployment, obj) ||
      isResource(StatefulSet, obj) ||
      isResource(Job, obj)
    ) {
      pod = props.spec.template;
    } else if (isResource(CronJob, obj)) {
      throw new Error("not implemented");
    } else if (isResource(Pod, obj)) {
      pod = props;
    } else {
      return;
    }

    // collect containers
    const containers = [
      ...(pod.spec.initContainers || []),
      ...pod.spec.containers,
    ];

    pod.spec.securityContext = pod.spec.securityContext || {};
    pod.spec.securityContext.seccompProfile =
      pod.spec.securityContext.seccompProfile !== undefined
        ? pod.spec.securityContext.seccompProfile
        : { type: "RuntimeDefault" };

    for (const container of containers) {
      container.securityContext = container.securityContext || {};
      if (container.securityContext.privileged) {
        // if container is privileged, allowPrivilegeEscalation cannot be false
        continue;
      }
      container.securityContext.allowPrivilegeEscalation =
        container.securityContext.allowPrivilegeEscalation !== undefined
          ? container.securityContext.allowPrivilegeEscalation
          : false;
    }
  }

  /**
   * Removes resources annotated with a helm test hook.
   *
   * Helm test resources aren't required for a successful deployment and, in some cases,
   * leaves failed resources in the cluster.
   *
   * NOTE: other infrastructure-as-code tools do this (https://github.com/pulumi/pulumi-kubernetes/issues/665)
   *
   * @param obj the api resource to modify
   * @returns void
   */
  removeHelmTest(obj: ApiObject) {
    const unsupportedHooks = ["test", "test-failure", "test-success"];
    const props = (obj as any).props;
    const annotations = props?.metadata?.annotations || {};
    const hook = annotations["helm.sh/hook"];
    if (hook === undefined) {
      return;
    }
    if (unsupportedHooks.find((v) => v === hook) === undefined) {
      return;
    }
    const parent = obj.node.scope || obj.chart;
    delete (parent.node as any)._children[obj.node.id as any];
  }

  /**
   * ArgoCD will not deploy applications whose custom resources don't have CRDs deployed.
   *
   * This interferes with 'eventual consistency'.
   *
   * This method will attempt to detect custom resources and will instruct argocd to
   * exclude these resources from dry-runs when their matching resource definitions are missing.
   *
   * @param obj the api object
   * @returns void
   */
  setArgocdSkipDryRunOnMissingResource(obj: ApiObject) {
    if (k8sApiGroups.has(obj.apiGroup)) {
      return;
    }
    this.addArgocdSyncOption(obj, "SkipDryRunOnMissingResource=true");
  }

  /**
   * ArgoCD requires server-side apply for resources whose serialized value is greater
   * than 262144 bytes.
   *
   * This method will annotate resources exceeding this size instructing ArgoCD to use
   * server-side apply.
   *
   * @param obj the api resource to modify
   * @returns void
   */
  setArgocdServerSideApply(obj: ApiObject) {
    const props = (obj as any).props;
    const contentLength = JSON.stringify(props).length;
    if (contentLength < 262144) {
      return;
    }
    this.addArgocdSyncOption(obj, "ServerSideApply=true");
  }

  addArgocdSyncOption(obj: ApiObject, option: string) {
    const key = "argocd.argoproj.io/sync-options";
    let value = option;
    const existing = (obj.metadata as any).annotations[key];
    if (existing !== undefined) {
      let values = existing.split(",");
      values.push(option);
      value = values.join(",");
    }
    obj.metadata.addAnnotation(key, value);
    (obj as any).props.metadata.annotations = (obj.metadata as any).annotations;
  }
}
