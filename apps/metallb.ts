import { Chart, Helm } from "cdk8s";
import { writeFile } from "fs/promises";
import { Namespace } from "../resources/k8s/k8s";
import {
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
} from "../utils/CliContext";
import { createNetworkPolicy } from "../utils/createNetworkPolicy";
import { exec } from "../utils/exec";
import { getHelmTemplateCommand } from "../utils/getHelmTemplateCommand";
import { getPrivilegedNamespaceLabels } from "../utils/getPrivilegedNamespaceLabels";

const chartData = {
  chart: "metallb",
  repo: "https://metallb.github.io/metallb",
  version: "0.14.5",
};

const manifests: ManifestsCallback = async (app) => {
  const { IpAddressPool, L2Advertisement } = await import(
    "../resources/metallb/metallb.io"
  );

  const chart = new Chart(app, "metallb", { namespace: "metallb" });

  createNetworkPolicy(chart, [
    {
      from: { pod: "metallb-controller" },
      to: { entity: "kube-apiserver", ports: [[6443, "tcp"]] },
    },
  ]);

  new Namespace(chart, "namespace", {
    metadata: {
      labels: {
        ...getPrivilegedNamespaceLabels(),
      },
      name: chart.namespace,
    },
  });

  new Helm(chart, "helm", {
    ...chartData,
    namespace: chart.namespace,
    helmFlags: ["--include-crds"],
    values: {
      // give all resources a static prefix
      fullnameOverride: "metallb",
      speaker: {
        frr: {
          // disabled because frr mode isn't being used
          enabled: false,
        },
      },
      frrk8s: {
        // disabled because frr-k8s mode isn't being used
        enabled: false,
      },
    },
  });

  // create an ip address pool from which metallb will assign ip addresses to load balancers
  const pool = new IpAddressPool(chart, "ip-address-pool", {
    metadata: { name: "default" },
    spec: {
      addresses: ["192.168.33.10-192.168.33.254"],
    },
  });

  // configure metallb to operate in l2 advertisement mode (via arp)
  new L2Advertisement(chart, "l2-advertisement", {
    metadata: { name: "default" },
    spec: {
      ipAddressPools: [pool.name],
    },
  });
  return chart;
};

const resources: ResourcesCallback = async (manifestFile) => {
  const manifest = await exec(getHelmTemplateCommand(chartData));
  await writeFile(manifestFile, manifest);
};

export default async function (context: CliContext) {
  context.manifests(manifests);
  context.resources(resources);
}
