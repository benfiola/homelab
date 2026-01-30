import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getPortsPromise } from "portfinder";
import { parse } from "yaml";
import { exec as cmdExec, spawn } from "./exec";
import { getTempy } from "./tempy";
import { stringify } from "./yaml";

export class KubernetesError extends Error {
  name = "KubernetesError";
}

export class ResourceNotFoundError extends KubernetesError {
  readonly namespace: string | null;
  readonly resource: string;

  name = "ResourceNotFoundError";

  constructor(namespace: string | null, resource: string) {
    const msgNs = namespace !== null ? namespace : "<cluster>";
    super(`Resource ${msgNs}/${resource} not found`);
    this.namespace = namespace;
    this.resource = resource;
  }
}

export class ResourceTypeNotFoundError extends KubernetesError {
  readonly resourceType: string;

  name = "ResourceTypeNotFound";

  constructor(resourceType: string) {
    super(`Resource type ${resourceType} not found`);
    this.resourceType = resourceType;
  }
}

interface ApplyOpts {
  forceConflicts?: boolean;
  serverSide?: boolean;
}

export const apply = async (manifest: string, opts: ApplyOpts = {}) => {
  const command = ["kubectl", "apply"];
  if (opts.serverSide) {
    command.push("--server-side");
    if (opts.forceConflicts) {
      command.push("--force-conflicts");
    }
  }
  command.push("-f", manifest);
  await cmdExec(command);
};

export const clusterInfo = async () => {
  await cmdExec(["kubectl", "cluster-info"]);
};

export const get = async (namespace: string | null, resource: string) => {
  let content: string;
  try {
    const command = ["kubectl", "get"];
    if (namespace !== null) {
      command.push(`--namespace=${namespace}`);
    }
    command.push(resource, "--output=yaml");
    content = await cmdExec(command);
  } catch (err: any) {
    if (err.stderr?.includes("doesn't have a resource type")) {
      const resourceType = resource.split("/")[0];
      throw new ResourceTypeNotFoundError(resourceType);
    }
    if (err.stderr?.includes("not found")) {
      throw new ResourceNotFoundError(namespace, resource);
    }
    throw err;
  }

  const parsed: Record<string, any> = parse(content);
  return parsed;
};

export const getIssuer = async () => {
  const content = await cmdExec([
    "kubectl",
    "get",
    "--raw",
    "/.well-known/openid-configuration",
  ]);
  const parsed = JSON.parse(content);

  const issuer = parsed.issuer;
  if (!issuer || typeof issuer !== "string") {
    throw new Error("invalid issuer field");
  }

  return issuer;
};

interface ExecOpts {
  container?: string;
}

export const exec = async (
  namespace: string,
  resource: string,
  command: string[],
  opts: ExecOpts = {}
) => {
  const cmd = ["kubectl", "exec", "-it", `--namespace=${namespace}`];
  if (opts.container) {
    cmd.push(`--container=${opts.container}`);
  }
  cmd.push(resource, "--", ...command);

  return await cmdExec(cmd);
};

interface RolloutOpts {
  timeout?: string;
}

export const rollout = async (
  namespace: string,
  resource: string,
  opts: RolloutOpts = {}
) => {
  const command = ["kubectl", "rollout", "status", `--namespace=${namespace}`];
  if (opts.timeout) {
    command.push(`--timeout=${opts.timeout}`);
  }
  command.push(resource);
  await cmdExec(command);
};

export interface KustomizeOpts {
  url?: string;
  dynamic?: Record<string, any>;
}

const createDynamicKustomization = async (
  dir: string,
  kustomization: Record<string, any>
): Promise<string> => {
  const kustomizationDir = join(dir, "kustomize");
  await mkdir(kustomizationDir, { recursive: true });

  const configPath = join(kustomizationDir, "kustomization.yaml");
  await writeFile(configPath, stringify(kustomization));

  return kustomizationDir;
};

export const kustomize = async (opts: KustomizeOpts) => {
  if (opts.dynamic && opts.url) {
    throw new Error("Cannot specify both dynamic and url in kustomize options");
  }

  const tempy = await getTempy();
  return await tempy.temporaryDirectoryTask(async (dir: string) => {
    let kustomization: string;

    if (opts.dynamic) {
      kustomization = await createDynamicKustomization(dir, opts.dynamic);
    } else if (opts.url) {
      kustomization = opts.url;
    } else {
      throw new Error(
        "Must specify either dynamic or url in kustomize options"
      );
    }

    return await cmdExec([
      "kubectl",
      "kustomize",
      "--load-restrictor=LoadRestrictionsNone",
      kustomization,
    ]);
  });
};

interface CpOpts {
  container?: string;
}

export const cp = async (src: string, dest: string, opts: CpOpts = {}) => {
  const command = ["kubectl", "cp"];
  if (opts.container) {
    command.push(`--container=${opts.container}`);
  }
  command.push(src, dest);

  await cmdExec(command);
};

type PortForwardCb = (localPorts: number[]) => Promise<void>;

export const portForward = async (
  namespace: string,
  resource: string,
  remotePorts: number[],
  cb: PortForwardCb
) => {
  const localPorts = await getPortsPromise(remotePorts.length);
  const portPairs = localPorts.map((lp, i) => `${lp}:${remotePorts[i]}`);
  const command = [
    "kubectl",
    "port-forward",
    `--namespace=${namespace}`,
    resource,
    ...portPairs,
  ];

  const { process, cancel: baseCancel } = spawn(command);

  let stdout = "";
  process.stdout?.on("data", (data: Buffer) => (stdout += data.toString()));

  let stderr = "";
  process.stderr?.on("data", (data: Buffer) => (stderr += data.toString()));

  let cancelled = false;
  const cancel = () => {
    if (!cancelled) {
      baseCancel();
    }
    cancelled = true;
  };

  const handleClose = (resolve: () => void, reject: (error: any) => void) => {
    return (code: number) => {
      if (!code || cancelled) {
        resolve();
      } else {
        reject({
          code,
          stdout,
          stderr,
          message: `command failed with exit code ${code}`,
        });
      }
    };
  };

  const waitForReady = () => {
    return new Promise<void>((resolve, reject) => {
      const onClose = handleClose(resolve, reject);
      const onError = reject;
      const onStdout = (chunk: Buffer) => {
        if (chunk.toString().includes("Forwarding from")) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        process.off("close", onClose);
        process.off("error", onError);
        process.stdout?.off("data", onStdout);
      };

      process.on("close", onClose);
      process.on("error", onError);
      process.stdout?.on("data", onStdout);
    });
  };

  const monitor = () => {
    return new Promise<void>((resolve, reject) => {
      process.on("close", handleClose(resolve, reject));
      process.on("error", reject);
    });
  };

  const executeCallback = async () => {
    await cb(localPorts);
    cancel();
  };

  try {
    await waitForReady();
    await Promise.all([monitor(), executeCallback()]);
  } finally {
    cancel();
  }
};

interface WaitOpts {
  all?: boolean;
  for?: string;
  selector?: string;
  timeout?: string;
}

export const wait = async (
  namespace: string | null,
  resource: string,
  opts: WaitOpts = {}
) => {
  const command = ["kubectl", "wait"];
  if (namespace !== null) {
    command.push(`--namespace=${namespace}`);
  }
  command.push(resource);
  if (opts.all) {
    command.push("--all");
  }
  if (opts.for) {
    command.push(`--for=${opts.for}`);
  }
  if (opts.selector) {
    command.push(`--selector=${opts.selector}`);
  }
  if (opts.timeout) {
    command.push(`--timeout=${opts.timeout}`);
  }
  await cmdExec(command);
};
