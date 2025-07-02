import { App, Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import * as crypto from "node:crypto";
import path from "node:path";
import {
  Namespace,
  PersistentVolumeClaim,
  Pod,
  Secret,
} from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import {
  createNetworkPolicy,
  createTargets,
  specialTargets,
} from "../utils/createNetworkPolicyNew";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getPodLabels } from "../utils/getPodLabels";
import { getStorageClassName } from "../utils/getStorageClassName";
import { temporaryDirectory } from "../utils/temporaryDirectory";

const helmData = {
  chart: "volsync",
  repo: "https://backube.github.io/helm-charts",
  version: "0.12.1",
};

const namespace = "volsync";

const policyTargets = createTargets((b) => ({
  controller: b.pod(namespace, "volsync"),
  mover: b.pod(null, "volsync-mover"),
}));

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "volsync", { namespace });

  createNetworkPolicy(chart, (b) => {
    const pt = policyTargets;
    const st = specialTargets;
    const googleApis = b.target({
      dns: "*.googleapis.com",
      ports: { api: [443, "tcp"] },
    });

    b.rule(pt.controller, st.kubeApiserver, "api");
    b.rule(pt.mover, googleApis, "api");
  });

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...helmData,
    namespace: chart.namespace,
    releaseName: "volsync",
    helmFlags: ["--include-crds"],
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(helmData));
  await writeFile(manifestFile, manifest);
};

/**
 * Clones a repository from another repository.
 *
 * Repositories are defined as secrets - generally `restic-<repository>`.
 * Cloning a repository allows one to inherit all the other properties of the
 * base repository (credentials, etc.) as a matter of convenience.
 *
 * @param src the source repository - must be expressed as <namespace>/<name>
 * @param dest the destination repository - must be expressed as <namespace>/<name>
 */
const cloneRepository = async (src: string, dest: string) => {
  const [srcNamespace, srcName] = src.split("/");
  const [destNamespace, destName] = dest.split("/");
  const srcSecret = JSON.parse(
    await exec([
      "kubectl",
      "get",
      "secrets",
      "--output=json",
      `--namespace=${srcNamespace}`,
      `restic-${srcName}`,
    ])
  );

  const app = new App();
  const chart = new Chart(app, "chart", { namespace: destNamespace });
  const srcRepository = atob(srcSecret["data"]["RESTIC_REPOSITORY"]);
  let parts = srcRepository.split(":");
  parts[parts.length - 1] = `/${destNamespace}/${destName}`;
  const destRepository = parts.join(":");
  const data = srcSecret.data;
  data["RESTIC_REPOSITORY"] = btoa(destRepository);
  new Secret(chart, "repository", {
    metadata: { name: `restic-${destName}` },
    data,
  });

  await temporaryDirectory(async (directory) => {
    const manifest = path.join(directory, "manifest.yaml");
    await writeFile(manifest, app.synthYaml());
    await exec(["kubectl", "apply", "-f", manifest]);
    console.log("repository cloned");
  });
};

interface CreateBackupPodOpts {
  user?: number;
}

/**
 * Creates a pod designed to facilitate the transfer of files from src to dest
 *
 * @param namespace the namespace of both pvcs
 * @param src the source pvc
 * @param dest the dest pvc
 * @param opts options
 */
const createTransferPod = async (
  namespace: string,
  src: string,
  dest: string,
  opts: CreateBackupPodOpts
) => {
  const user = opts.user ? opts.user : 1000;

  const app = new App();
  const chart = new Chart(app, "chart", { namespace });
  const id = crypto.randomBytes(3).toString("hex");
  const pod = new Pod(chart, "pod", {
    metadata: { name: `backup-${id}` },
    spec: {
      containers: [
        {
          name: "backup",
          image: "alpine:latest",
          args: ["sh", "-c", "while true; do sleep 1; done;"],
          volumeMounts: [
            { name: "src", mountPath: "/src" },
            { name: "dest", mountPath: "/dest" },
          ],
        },
      ],
      securityContext: {
        fsGroup: user,
        fsGroupChangePolicy: "Always",
        runAsGroup: user,
        runAsNonRoot: true,
        runAsUser: user,
        seccompProfile: { type: "RuntimeDefault" },
      },
      volumes: [
        {
          name: "src",
          persistentVolumeClaim: {
            claimName: src,
          },
        },
        {
          name: "dest",
          persistentVolumeClaim: {
            claimName: dest,
          },
        },
      ],
    },
  });

  await temporaryDirectory(async (directory) => {
    const manifest = path.join(directory, "manifest.yaml");
    await writeFile(manifest, app.synthYaml());
    await exec(["kubectl", "apply", "-f", manifest]);
    console.log(`created pod: ${chart.namespace}/${pod.name}`);
  });
};

interface RestoreToPvcOpts {
  before?: Date;
  size?: string;
  user?: number;
}

/**
 * Restores a volsync backup from a repository to a new pvc and prints the pvc name.
 *
 * NOTE: Also creates a ReplicationDestination with the same name as the created pvc.
 *
 * @param src the name of the repository to restore from - must be formatted <namespace>/<name>
 * @param before only select snapshots before this date
 */
const restoreToPvc = async (src: string, opts: RestoreToPvcOpts) => {
  const { ReplicationDestination } = await import(
    "../resources/volsync/volsync.backube"
  );
  const [namespace, name] = src.split("/");
  const before = opts.before ? opts.before : new Date();
  const size = opts.size ? opts.size : "10Gi";
  const user = opts.user ? opts.user : 1000;

  // NOTE: cdk8s is unable to serialize a `Date` object without this patch
  (before as any).toJSON = () => before.toISOString();

  const id = crypto.randomBytes(3).toString("hex");
  const app = new App();
  const chart = new Chart(app, "chart", { namespace });
  const pvc = new PersistentVolumeClaim(chart, "pvc", {
    metadata: { name: `${name}-restore-${id}` },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: { value: size },
        },
      },
      storageClassName: getStorageClassName("backup"),
    },
  });

  new ReplicationDestination(chart, "rep-dest", {
    metadata: { name: pvc.name },
    spec: {
      restic: {
        copyMethod: "Direct" as any,
        destinationPvc: pvc.name,
        moverPodLabels: getPodLabels("volsync-mover"),
        moverSecurityContext: {
          fsGroup: user,
          fsGroupChangePolicy: "Always",
          runAsGroup: user,
          runAsNonRoot: true,
          runAsUser: user,
          seccompProfile: { type: "RuntimeDefault" },
        },
        repository: `restic-${name}`,
        restoreAsOf: {
          toJSON: () => "",
          toISOString: () => before.toISOString(),
        } as any,
        storageClassName: getStorageClassName("backup"),
      },
      trigger: {
        manual: "manual",
      },
    },
  });

  await temporaryDirectory(async (directory) => {
    const manifest = path.join(directory, "manifest.yaml");
    await writeFile(manifest, app.synthYaml());
    await exec(["kubectl", "apply", "-f", manifest]);
    console.log(`created pvc: ${chart.namespace}/${pvc.name}`);
  });
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
  context.command((program) => {
    program
      .command("clone-repository <src> <dest>")
      .description("clones a repository")
      .action(cloneRepository);
    program
      .command("create-transfer-pod <namespace> <src> <dest>")
      .description(
        "creates a pod designed to facilitate the transfer of files between pvcs"
      )
      .option("--user <user>", "the pod uid", parseInt)
      .action(createTransferPod);
    program
      .command("restore-to-pvc <repository>")
      .option(
        "--before <before>",
        "consider snapshots before this date",
        (v: string) => new Date(v)
      )
      .option("--size <size>", "size of the new pvc", parseInt)
      .option("--user <user>", "uid for backup", parseInt)
      .description("restores a repository backup to a pvc")
      .action(restoreToPvc);
  });
}
