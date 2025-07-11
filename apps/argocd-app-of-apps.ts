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
 * Additional options supplied to the `createApp` function
 */
interface CreateAppOpts {
  wave?: number;
}

/**
 * Creates an Application resource with common settings.
 *
 * @param chart the chart to attach the application resource to
 * @param name the name of the application
 * @returns the created Application resource
 */
const createApp = (chart: Construct, name: string, opts?: CreateAppOpts) => {
  const annotations: Record<string, string> = {};
  if (opts?.wave !== undefined) {
    annotations["argocd.argoproj.io/sync-wave"] = `${opts.wave}`;
  }
  return new Application(chart, name, {
    metadata: {
      name: name,
      annotations,
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

  const chart = new Chart(app, "chart", { namespace: "argocd" });

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

  const chart = new Chart(app, "chart", { namespace: "argocd" });

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

  const apps: (string | [string, CreateAppOpts])[] = [
    "access-operator",
    "alloy",
    "argocd",
    "cert-manager",
    ["cilium", { wave: 0 }],
    "escape-from-tarkov",
    "external-dns",
    "factorio",
    "intel-device-plugins",
    "kube-prometheus",
    "loki",
    "minecraft",
    "minio",
    "node-feature-discovery",
    "piraeus",
    "sealed-secrets",
    "snapshot-controller",
    "trust-manager",
    "volsync",
  ];
  let defaultWave = 0;
  for (const app of apps) {
    if (!Array.isArray(app)) {
      continue;
    }
    const wave = app[1].wave;
    if (wave === undefined) {
      continue;
    }
    defaultWave = Math.max(defaultWave, wave + 1);
  }
  for (const app of apps) {
    let name: string;
    let opts: CreateAppOpts;
    if (!Array.isArray(app)) {
      name = app;
      opts = {};
    } else {
      name = app[0];
      opts = app[1] || {};
    }
    opts.wave = opts.wave !== undefined ? opts.wave : defaultWave;
    createApp(chart, name, opts);
  }
  return chart;
};

export default function (context: CliContext) {
  context.bootstrap(bootstrap);
  context.manifests(manifests);
}
