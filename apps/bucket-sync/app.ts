import type { AppFunction } from "../../tools/lib/app.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm(
    "oci://ghcr.io/benfiola/homelab-images/charts/bucket-sync?version=1.2.0",
  );

  h.namespace();

  h.vpa({ kind: "Deployment", name: "bucket-sync" });
};

export const network: NetworkFunction = (n) => {
  const bucketSync = n.subject(
    "bucket-sync",
    pod("bucket-sync", "bucket-sync"),
  );
  const bucketSyncJob = n.subject(
    "bucket-sync-job",
    pod("bucket-sync-job", "*"),
  );

  bucketSync.to(n.kubeApiServer, tcp(6443));
  n.host.to(bucketSync, tcp(8081));
  bucketSyncJob
    .to(n.ref("garage"), tcp(3900))
    .to(dns("*.backblazeb2.com"), tcp(443))
    .to(dns("*.backblaze.com"), tcp(443));
};
