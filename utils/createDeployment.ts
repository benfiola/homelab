import { Chart } from "cdk8s";
import {
  Container as ActualContainer,
  ConfigMap,
  Deployment,
  IntOrString,
  PersistentVolumeClaim,
  Quantity,
  Secret,
  Volume,
} from "../resources/k8s/k8s";
import { SealedSecret } from "../resources/sealed-secrets/bitnami.com";
import { getPodLabels } from "./getPodLabels";
import { getPodRequests } from "./getPodRequests";

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
interface Container {
  args?: string[];
  command?: string[];
  env?: EnvMap;
  envFrom?: EnvFrom[];
  image: string;
  mounts?: MountMap;
  name: string;
  ports?: PortMap;
  probe?: [string, number];
  resources?: {
    cpu?: number;
    mem?: number;
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
 * Function that converts a simple 'container' data object
 * into a proper kubernetes container resource.
 */
const convertContainer = (container: Container): ActualContainer => {
  const env = container.env ? convertEnvMap(container.env) : undefined;
  const envFrom = container.envFrom?.map(convertEnvFrom);
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
    livenessProbe: probe,
    name: container.name,
    ports,
    readinessProbe: probe,
    resources: convertPodRequests(getPodRequests(container.resources)),
    securityContext: {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
    volumeMounts,
  };
};

type VolumeMap = { [k: string]: PersistentVolumeClaim };

/**
 * Converts a volume map to a list of volume references to persistent volume claims
 *
 * @param volumeMap the volume map
 */
const convertVolumeMap = (volumeMap: VolumeMap) => {
  const toReturn: Volume[] = [];
  Object.entries(volumeMap).map(([volumeName, claim]) => {
    toReturn.push({
      name: volumeName,
      persistentVolumeClaim: {
        claimName: claim.name,
      },
    });
  });
  return toReturn;
};

interface CreateDeploymentOpts {
  containers: Container[];
  namespace?: string;
  name: string;
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
      strategy,
      template: {
        metadata: {
          labels: {
            ...getPodLabels(opts.name),
          },
        },
        spec: {
          containers,
          securityContext: {
            fsGroup: user,
            fsGroupChangePolicy: "Always",
            runAsGroup: user,
            runAsNonRoot: true,
            runAsUser: user,
            seccompProfile: { type: "RuntimeDefault" },
          },
          serviceAccountName: opts.serviceAccount,
          volumes,
        },
      },
    },
  });
  return deployment;
};
