import { Chart } from "cdk8s";
import { Construct } from "constructs";
import { Application } from "../resources/argocd/argoproj.io";
import {
  BootstrapCallback,
  CliContext,
  ManifestsCallback,
} from "../utils/CliContext";
import { createSealedSecret } from "../utils/createSealedSecret";
import { parseEnv } from "../utils/parseEnv";

/**
 * Creates an Application resource with common settings.
 *
 * @param chart the chart to attach the application resource to
 * @param name the name of the application
 * @returns the created Application resource
 */
const createApp = (chart: Construct, name: string) => {
  return new Application(chart, name, {
    metadata: {
      name: name,
      finalizers: ["resources-finalizer.argocd.argoproj.io"],
    },
    spec: {
      destination: {
        server: "https://kubernetes.default.svc",
      },
      project: "default",
      source: {
        path: name,
        repoUrl: "https://github.com/benfiola/homelab-manifests",
        targetRevision: "main",
      },
      syncPolicy: {
        automated: {
          allowEmpty: true,
          prune: true,
          selfHeal: true,
        },
        retry: {
          backoff: {
            maxDuration: "5s",
          },
          limit: 100,
        },
      },
    },
  });
};

const bootstrap: BootstrapCallback = async (app) => {
  const env = parseEnv((zod) => ({
    ARGOCD_GITHUB_TOKEN: zod.string(),
  }));

  const chart = new Chart(app, "argocd-app-of-apps", { namespace: "argocd" });

  await createSealedSecret(chart, "sealed-secret-github", {
    metadata: {
      namespace: chart.namespace,
      name: "github-com-benfiola-homelab-manifests",
      labels: { "argocd.argoproj.io/secret-type": "repository" },
    },
    stringData: {
      password: env.ARGOCD_GITHUB_TOKEN,
      url: "https://github.com/benfiola/homelab-manifests",
      username: "unknown",
    },
  });

  createApp(chart, "argocd-app-of-apps");

  return chart;
};

const manifests: ManifestsCallback = async (app) => {
  const env = parseEnv((zod) => ({
    ARGOCD_GITHUB_TOKEN: zod.string(),
  }));

  const chart = new Chart(app, "argocd-app-of-apps", { namespace: "argocd" });

  await createSealedSecret(chart, "sealed-secret-github", {
    metadata: {
      namespace: chart.namespace,
      name: "github-com-benfiola-homelab-manifests",
      labels: { "argocd.argoproj.io/secret-type": "repository" },
    },
    stringData: {
      password: env.ARGOCD_GITHUB_TOKEN,
      url: "https://github.com/benfiola/homelab-manifests",
      username: "unknown",
    },
  });

  const apps = [
    "access-operator",
    "argocd",
    "cert-manager",
    "cilium",
    "external-dns",
    "factorio",
    "kube-prometheus",
    "minecraft",
    "minio",
    "piraeus",
    "sealed-secrets",
    "seven-days-to-die",
    "snapshot-controller",
    "trust-manager",
    "volsync",
  ];
  for (const app of apps) {
    createApp(chart, app);
  }

  return chart;
};

export default function (context: CliContext) {
  context.bootstrap(bootstrap);
  context.manifests(manifests);
}
