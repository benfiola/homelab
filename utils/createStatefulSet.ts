import { Chart } from "cdk8s";
import { StatefulSet } from "../resources/k8s/k8s";
import {
  Container,
  convertContainer,
  convertVolumeMap,
  VolumeMap,
} from "./createDeployment";
import { getPodLabels } from "./getPodLabels";
import { getPodSecurityContext } from "./getPodSecurityContext";
import { getStorageClassName } from "./getStorageClassName";

type VolumeClaimTemplateMap = { [k: string]: string };

/**
 * Converts a (simplified) volume claim template map to a list of persistent volume claims
 *
 * @param volumeMap the volume map
 * @returns a list of PersistentVolumeClaims
 */
const convertVolumeClaimTemplateMap = (
  volumeTemplateMap: VolumeClaimTemplateMap
): any => {
  return Object.entries(volumeTemplateMap).map(([name, size]) => {
    return {
      metadata: { name },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: {
          requests: {
            storage: size,
          },
        },
        storageClassName: getStorageClassName(),
      },
    };
  });
};

interface CreateStatefulSetOpts {
  initContainers?: Container[];
  containers: Container[];
  namespace?: string;
  name: string;
  replicas?: number;
  serviceAccount: string;
  user?: number;
  volumes?: VolumeMap;
  volumeClaimTemplates?: VolumeClaimTemplateMap;
}

/**
 * Creates a statefulset resource via a streamlined configuration.
 */
export const createStatefulSet = (
  chart: Chart,
  id: string,
  opts: CreateStatefulSetOpts
) => {
  const containers = opts.containers.map(convertContainer);
  const initContainers =
    opts.initContainers !== undefined
      ? opts.initContainers.map(convertContainer)
      : undefined;
  const user = opts.user !== undefined ? opts.user : 1001;
  const volumes = opts.volumes ? convertVolumeMap(opts.volumes) : undefined;
  const volumeClaimTemplates = opts.volumeClaimTemplates
    ? convertVolumeClaimTemplateMap(opts.volumeClaimTemplates)
    : undefined;

  const statefulSet = new StatefulSet(chart, id, {
    metadata: { namespace: chart.namespace, name: opts.name },
    spec: {
      selector: {
        matchLabels: {
          ...getPodLabels(opts.name),
        },
      },
      replicas: opts.replicas,
      serviceName: opts.name,
      template: {
        metadata: {
          labels: {
            ...getPodLabels(opts.name),
          },
        },
        spec: {
          initContainers,
          containers,
          securityContext: getPodSecurityContext(user),
          serviceAccountName: opts.serviceAccount,
          volumes,
        },
      },
      volumeClaimTemplates,
    },
  });

  return statefulSet;
};
