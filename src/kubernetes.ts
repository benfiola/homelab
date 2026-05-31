import { execa } from "execa";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getPortsPromise } from "portfinder";
import { parse } from "yaml";
import { exec as cmdExec, ExecError } from "./exec";
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

  name = "ResourceTypeNotFoundError";

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
  } catch (err) {
    if (err instanceof ExecError) {
      const stderr = String(err.stderr ?? "");
      if (stderr.includes("doesn't have a resource type")) {
        const resourceType = resource.split("/")[0];
        throw new ResourceTypeNotFoundError(resourceType);
      }
      if (stderr.includes("not found")) {
        throw new ResourceNotFoundError(namespace, resource);
      }
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
  opts: ExecOpts = {},
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
  opts: RolloutOpts = {},
) => {
  const command = ["kubectl", "rollout", "status", `--namespace=${namespace}`];
  if (opts.timeout) {
    command.push(`--timeout=${opts.timeout}`);
  }
  command.push(resource);
  await cmdExec(command);
};

export type KustomizeOpts =
  | { url: string; dynamic?: never }
  | { dynamic: Record<string, any>; url?: never };

const createDynamicKustomization = async (
  dir: string,
  kustomization: Record<string, any>,
): Promise<string> => {
  const kustomizationDir = join(dir, "kustomize");
  await mkdir(kustomizationDir, { recursive: true });

  const configPath = join(kustomizationDir, "kustomization.yaml");
  await writeFile(configPath, stringify(kustomization));

  return kustomizationDir;
};

export const kustomize = async (opts: KustomizeOpts) => {
  const tempy = await getTempy();
  return await tempy.temporaryDirectoryTask(async (dir: string) => {
    const kustomization = opts.dynamic
      ? await createDynamicKustomization(dir, opts.dynamic)
      : opts.url!;

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
  cb: PortForwardCb,
) => {
  const localPorts = await getPortsPromise(remotePorts.length);
  const portPairs = localPorts.map((lp, i) => `${lp}:${remotePorts[i]}`);

  const ac = new AbortController();
  const subprocess = execa(
    "kubectl",
    ["port-forward", `--namespace=${namespace}`, resource, ...portPairs],
    {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      cancelSignal: ac.signal,
      reject: false,
    },
  );

  try {
    await new Promise<void>((resolve, reject) => {
      subprocess.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Forwarding from")) resolve();
      });
      subprocess.then((result) => {
        if (!result.isCanceled) {
          reject(
            new Error(
              `port-forward exited unexpectedly with code ${result.exitCode}`,
            ),
          );
        }
      });
    });

    await cb(localPorts);
  } finally {
    ac.abort();
    await subprocess;
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
  opts: WaitOpts = {},
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
