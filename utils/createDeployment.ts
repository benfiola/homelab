import { Chart } from "cdk8s";
import {
  Container as ActualContainer,
  ConfigMap,
  Deployment,
  EnvFromSource,
  IntOrString,
  PersistentVolumeClaim,
  Quantity,
  Secret,
  Volume,
} from "../resources/k8s/k8s";
import { SealedSecret } from "../resources/sealed-secrets/bitnami.com";
import { getContainerSecurityContext } from "./getContainerSecurityContext";
import { getHash } from "./getHash";
import { getPodLabels } from "./getPodLabels";
import { getPodRequests } from "./getPodRequests";
import { getPodSecurityContext } from "./getPodSecurityContext";

/**
 * Type that unwraps potentially undefined values - returning the inner type
 */
type Defined<V extends any> = V extends undefined ? never : V;

type EnvFromResource = Secret | SealedSecret | ConfigMap;
type EnvFrom = EnvFromResource | [EnvFromResource, string];
type ActualEnvFrom = Defined<ActualContainer["envFrom"]>[number];

/**
 * Function that converts a simple 'envFrom' field (which points to a cdk8s resource, or a cdk8s resource + key)
 * into a proper container 'envFrom' reference.
 */
const convertEnvFrom = (envFrom: EnvFrom): ActualEnvFrom => {
  let ref;
  let resource: EnvFromResource;
  let key: string | undefined;

  if (Array.isArray(envFrom)) {
    resource = envFrom[0];
    key = envFrom[1];
  } else {
    resource = envFrom;
  }

  if (resource.kind === "ConfigMap") {
    ref = "configMapRef";
  } else if (
    ["Secret", "SealedSecret"].find((v) => v === resource.kind) !== undefined
  ) {
    ref = "secretRef";
  } else {
    throw new Error(`unimplemented: ${resource}`);
  }

  return {
    [ref]: {
      name: resource.name,
      key,
    },
  };
};

type EnvMap = { [k: string]: string };
type ActualEnv = Defined<ActualContainer["env"]>[number];

/**
 * Function that converts a simple 'env' field (a Record<[env var name], [env var value]> map)
 * into a proper container 'env' reference.
 */
const convertEnvMap = (env: EnvMap): ActualEnv[] => {
  return Object.entries(env).map(([name, value]) => ({
    name,
    value,
  }));
};

type Protocol = "tcp" | "udp";
type PortMap = { [k: string]: [number, Protocol] };
type ActualPort = Defined<ActualContainer["ports"]>[number];

/**
 * Function that converts a simple 'ports' field (a Record<[port name], [<port number>, <port protocol>] value)
 * into a proper container 'ports' reference.
 */
const convertPortMap = (ports: PortMap): ActualPort[] => {
  return Object.entries(ports).map(([name, [containerPort, protocol]]) => {
    return {
      name,
      containerPort,
      protocol: protocol.toUpperCase(),
    };
  });
};

/**
 * Converts a simple 'probe' field (a [<string path>, <number port>] tuple) into an
 * HTTP GET liveness/readiness probe.
 *
 */
const convertProbe = (probe: [string, number]) => {
  return {
    httpGet: {
      path: probe[0],
      port: IntOrString.fromNumber(probe[1]),
    },
    initialDelaySeconds: 10,
    periodSeconds: 10,
    timeoutSeconds: 5,
    failureThreshold: 5,
    successThreshold: 1,
  };
};

type MountMap = { [k: string]: string };

/**
 * Converts a simple 'mount map' into a container volume mount.
 *
 * @param mountMap a map of mount name -> path mappings
 * @returns a list of container volume mounts
 */
const convertMountMap = (mountMap: MountMap) => {
  return Object.entries(mountMap).map(([name, mountPath]) => ({
    name,
    mountPath,
  }));
};

export interface Container {
  args?: string[];
  command?: string[];
  env?: EnvMap;
  envFrom?: EnvFrom[];
  image: string;
  imagePullPolicy?: "Always" | "Never" | "IfNotPresent";
  mounts?: MountMap;
  name: string;
  ports?: PortMap;
  probe?: [string, number];
  resources?: {
    cpu?: number;
    mem?: number;
    ephemeralStorage?: number;
  };
}

/**
 * Converts literal subvalues in a request object into cdk8s Quantity subvalues.
 *
 */
const convertPodRequests = (
  requests: Record<string, Record<string, string>>
) => {
  const toReturn: Record<string, Record<string, Quantity>> = {};
  for (const [key, value] of Object.entries(requests)) {
    toReturn[key] = {};
    for (const [subKey, subValue] of Object.entries(value)) {
      toReturn[key][subKey] = Quantity.fromString(subValue);
    }
  }
  return toReturn;
};

/**
 * Calculates a hash from a container's 'envFrom' values.
 *
 * @param envFroms environment variable sources
 * @returns a string hash
 */
const calculateEnvFromHash = (envFroms: EnvFrom[]) => {
  const data = [];
  for (const envFrom of envFroms) {
    let resource: EnvFromResource;
    if (Array.isArray(envFrom)) {
      resource = envFrom[0];
    } else {
      resource = envFrom;
    }

    if (resource.kind === "SealedSecret") {
      const checksum = resource.metadata.getLabel("bfiola.dev/checksum");
      if (!checksum) {
        throw new Error(`checksum not found: ${resource}`);
      }
      data.push({ checksum: checksum });
    } else {
      throw new Error(
        `unimplemented resource: ${resource.apiVersion}/${resource.kind}`
      );
    }
  }
  return getHash(JSON.stringify(data)).toString();
};

/**
 * Function that converts a simple 'container' data object
 * into a proper kubernetes container resource.
 */
export const convertContainer = (container: Container): ActualContainer => {
  let env = container.env ? convertEnvMap(container.env) : [];
  let envFrom: EnvFromSource[] | undefined;
  if (container.envFrom) {
    envFrom = container.envFrom?.map(convertEnvFrom);
    const envFromHash = calculateEnvFromHash(container.envFrom);
    env = env || [];
    env.push({ name: "_ENV_FROM_HASH", value: envFromHash });
  }
  const ports = container.ports ? convertPortMap(container.ports) : undefined;
  const probe = container.probe ? convertProbe(container.probe) : undefined;
  const volumeMounts = container.mounts
    ? convertMountMap(container.mounts)
    : undefined;

  return {
    args: container.args,
    command: container.command,
    env,
    envFrom,
    image: container.image,
    imagePullPolicy: container.imagePullPolicy,
    livenessProbe: probe,
    name: container.name,
    ports,
    readinessProbe: probe,
    resources: convertPodRequests(getPodRequests(container.resources)),
    securityContext: getContainerSecurityContext(),
    volumeMounts,
  };
};

export type VolumeMap = { [k: string]: PersistentVolumeClaim | ConfigMap };

/**
 * Converts a volume map to a list of volume references to resources
 *
 * @param volumeMap the volume map
 */
export const convertVolumeMap = (volumeMap: VolumeMap) => {
  const toReturn: Volume[] = [];
  Object.entries(volumeMap).map(([volumeName, resource]) => {
    let volume;
    if (resource.kind === "PersistentVolumeClaim") {
      volume = {
        persistentVolumeClaim: {
          claimName: resource.name,
        },
      };
    } else if (resource.kind === "ConfigMap") {
      volume = { configMap: { name: resource.name } };
    } else {
      throw new Error(`unrecognized resource kind: ${resource.kind}`);
    }

    toReturn.push({
      name: volumeName,
      ...volume,
    });
  });
  return toReturn;
};

interface CreateDeploymentOpts {
  initContainers?: Container[];
  containers: Container[];
  namespace?: string;
  name: string;
  replicas?: number;
  serviceAccount: string;
  updateStrategy?: "Recreate";
  user?: number;
  volumes?: VolumeMap;
}

/**
 * Creates a deployment resource via a streamlined configuration.
 */
export const createDeployment = (
  chart: Chart,
  id: string,
  opts: CreateDeploymentOpts
) => {
  const containers = opts.containers.map(convertContainer);
  const initContainers =
    opts.initContainers !== undefined
      ? opts.initContainers.map(convertContainer)
      : undefined;
  const strategy = opts.updateStrategy
    ? { type: opts.updateStrategy }
    : undefined;
  const user = opts.user !== undefined ? opts.user : 1001;
  const volumes = opts.volumes ? convertVolumeMap(opts.volumes) : undefined;

  const deployment = new Deployment(chart, id, {
    metadata: { namespace: chart.namespace, name: opts.name },
    spec: {
      selector: {
        matchLabels: {
          ...getPodLabels(opts.name),
        },
      },
      replicas: opts.replicas,
      strategy,
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
    },
  });

  return deployment;
};
