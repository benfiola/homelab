import type { AppFunction } from "../../tools/lib/app.ts";
import { prometheusRules } from "../../tools/lib/k8s/monitoring.ts";
import {
  dns,
  pod,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = async (h) => {
  const ns = h.namespace();

  await ns.helm(
    "https://backube.github.io/helm-charts/volsync?version=0.17.0",
    {
      values: {
        metrics: { disableAuth: true },
        "kube-rbac-proxy-resources": {
          requests: { cpu: "5m", memory: "64Mi" },
          limits: null,
        },
        resources: { requests: { cpu: "100m", memory: "64Mi" }, limits: null },
      },
    },
  );

  ns.add(
    ...prometheusRules("alert", [
      {
        name: "volsync",
        rules: [
          {
            alert: "VolSyncVolumeOutOfSync",
            expr: "volsync_volume_out_of_sync == 1",
            for: "15m",
            labels: { severity: "warning" },
            annotations: {
              summary:
                "VolSync volume {{ $labels.obj_namespace }}/{{ $labels.obj_name }} is out of sync",
              description:
                "VolSync {{ $labels.role }} {{ $labels.obj_namespace }}/{{ $labels.obj_name }} has been out of sync for 15 minutes: its last sync is older than its schedule allows.",
            },
          },
          {
            alert: "VolSyncMissedIntervals",
            expr: "increase(volsync_missed_intervals_total[1h]) > 0",
            labels: { severity: "warning" },
            annotations: {
              summary:
                "VolSync {{ $labels.obj_namespace }}/{{ $labels.obj_name }} missed a sync interval",
              description:
                "VolSync {{ $labels.role }} {{ $labels.obj_namespace }}/{{ $labels.obj_name }} missed at least one scheduled sync in the last hour.",
            },
          },
        ],
      },
    ]),
  );

  ns.vpa({ kind: "Deployment", name: "volsync" });
};

export const network: NetworkFunction = (n) => {
  const volsync = n.subject("volsync", pod("volsync", "volsync"));
  const mover = n.subject("volsync-mover", pod("volsync-mover", "*"));

  volsync.to(n.kubeApiServer, tcp(6443));
  n.host.to(volsync, tcp(8081));
  n.ref("prometheus").to(volsync, tcp(8443));

  mover
    .to(dns("*.backblazeb2.com"), tcp(443))
    .to(dns("*.backblaze.com"), tcp(443));
};
