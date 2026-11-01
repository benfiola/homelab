import type { AppFunction } from "../../tools/lib/app.ts";
import {
  component,
  tcp,
  type NetworkFunction,
} from "../../tools/lib/k8s/network-policy.ts";

export const app: AppFunction = (h) => {
  h.helm("https://grafana.github.io/helm-charts/loki?version=7.5.0", {
    values: "values.yaml",
  });

  h.namespace();

  // loki stores its data in garage. the helm values (values.yaml) read the key from the
  // Secret garage generates: `garage-key-garage-loki`.
  const key = h.garageKey(h.app);
  h.garageBucket(`${h.app}-admin`, [key]);
  h.garageBucket(`${h.app}-chunks`, [key]);
  h.garageBucket(`${h.app}-ruler`, [key]);

  h.vpa({ kind: "StatefulSet", name: "loki-chunks-cache" });
  h.vpa({ kind: "StatefulSet", name: "loki" });
  h.vpa({ kind: "Deployment", name: "loki-gateway" });
  h.vpa({ kind: "StatefulSet", name: "loki-results-cache" });
};

export const network: NetworkFunction = (n) => {
  const loki = n.subject("loki", component("single-binary", "loki"));
  const lokiGateway = n.subject("loki-gateway", component("gateway", "loki"));
  const lokiMemcachedChunksCache = n.subject(
    "loki-memcached-chunks-cache",
    component("memcached-chunks-cache", "loki"),
  );
  const lokiMemcachedResultsCache = n.subject(
    "loki-memcached-results-cache",
    component("memcached-results-cache", "loki"),
  );

  loki
    .to(n.kubeApiServer, tcp(6443))
    .to(n.ref("garage"), tcp(3900))
    .to(lokiMemcachedChunksCache, tcp(11211))
    .to(lokiMemcachedResultsCache, tcp(11211));
  n.host.to(loki, tcp(3100));
  lokiGateway.to(loki, tcp(3100));
  n.host.to(lokiGateway, tcp(8080));
  n.host.to(lokiMemcachedChunksCache, tcp(9150, 11211));
  n.host.to(lokiMemcachedResultsCache, tcp(9150, 11211));
};
