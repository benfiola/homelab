import { App, Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import * as crypto from "node:crypto";
import path from "node:path";
import { Namespace, PersistentVolumeClaim } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { temporaryDirectory } from "../utils/temporaryDirectory";

const appData = {
  chart: "volsync",
  repo: "https://backube.github.io/helm-charts",
  version: "0.11.0",
};

const manifests: ManifestsCallback = async (app) => {
  const chart = new Chart(app, "volsync", { namespace: "volsync" });

  createNetworkPolicy(chart, "network-policy", [
    {
      from: { pod: "volsync" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },

    {
      from: { externalPod: ["*", "volsync-mover"] },
      to: { dns: "*.googleapis.com", ports: [[443, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...appData,
    namespace: chart.namespace,
    releaseName: "volsync",
    helmFlags: ["--include-crds"],
  });

  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(appData));
  await writeFile(manifestFile, manifest);
};

/**
 * Restores a volsync backup to a new pvc and prints the pvc name.
 * NOTE: Also creates a ReplicationDestination with the same name as the created pvc.
 * @param namespace the namespace of the pvc to restore from
 * @param sourcePvcName the name of the pvc to restore from
 * @param before only select snapshots before this date
 */
const restoreToPvc = async (
  namespace: string,
  sourcePvcName: string,
  { before }: { before: Date }
) => {
  // NOTE: cdk8s is unable to serialize a `Date` object without this patch
  (before as any).toJSON = () => before.toISOString();

  const { ReplicationDestination } = await import(
    "../resources/volsync/volsync.backube"
  );

  const srcPvc = JSON.parse(
    await exec([
      "kubectl",
      "get",
      "persistentvolumeclaims",
      "--output=json",
      `--namespace=${namespace}`,
      sourcePvcName,
    ])
  );
  const repSrc = JSON.parse(
    await exec([
      "kubectl",
      "get",
      "replicationsources",
      "--output=json",
      `--namespace=${namespace}`,
      sourcePvcName,
    ])
  );

  const id = crypto.randomBytes(3).toString("hex");
  const app = new App();
  const chart = new Chart(app, "chart", { namespace: namespace });
  const pvc = new PersistentVolumeClaim(chart, "pvc", {
    metadata: { name: `${sourcePvcName}-restore-${id}` },
    spec: {
      accessModes: srcPvc.spec.accessModes,
      resources: {
        requests: {
          storage: { value: srcPvc.spec.resources.requests.storage },
        },
      },
      storageClassName: srcPvc.spec.storageClassName,
    },
  });
  new ReplicationDestination(chart, "rep-dest", {
    metadata: { name: pvc.name },
    spec: {
      restic: {
        copyMethod: "Direct" as any,
        destinationPvc: pvc.name,
        moverPodLabels: repSrc.spec.restic.moverPodLabels,
        moverSecurityContext: repSrc.spec.restic.moverSecurityContext,
        repository: repSrc.spec.restic.repository,
        restoreAsOf: {
          toJSON: () => "",
          toISOString: () => before.toISOString(),
        } as any,
        storageClassName: repSrc.spec.restic.storageClassName,
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
      .command("restore-to-pvc <namespace> <pvc-name>")
      .option(
        "--before <before>",
        "consider snapshots before this date",
        (v: string) => new Date(v),
        new Date()
      )
      .description("restores a backup to a pvc")
      .action(restoreToPvc);
  });
}
