import { Chart } from "cdk8s";
import { Ingress } from "../resources/k8s/k8s";
import { getCertIssuerAnnotations } from "./getCertIssuerAnnotation";
import { getIngressClassName } from "./getIngressClassName";

/**
 * Simplified representation of a service connection
 */
interface Service {
  name: string;
  port?: string | number;
}

/**
 * Options used to customize the created ingress
 */
interface CreateIngressOpts {
  name: string;
  host: string;
  insecure?: boolean;
  services: Record<string, Service>;
}

/**
 * Convenience method to generate a simple ingress
 * @param chart the chart to add the resource to
 * @param id the id to use
 * @param opts opts for creating the ingress
 * @returns the created Ingress resource
 */
export const createIngress = (
  chart: Chart,
  id: string,
  opts: CreateIngressOpts
) => {
  const paths = Object.entries(opts.services).map(([path, svc]) => {
    let port;
    if (typeof svc.port === "number") {
      port = { number: svc.port };
    } else if (typeof svc.port === "string") {
      port = { name: svc.port };
    }
    return {
      path,
      pathType: "Prefix",
      backend: {
        service: {
          name: svc.name,
          port,
        },
      },
    };
  });

  let annotations: Record<string, string> = {};
  let tls;
  if (!opts.insecure) {
    annotations = { ...getCertIssuerAnnotations() };
    tls = [{ hosts: [opts.host], secretName: `${opts.name}-tls` }];
  }

  return new Ingress(chart, id, {
    metadata: {
      name: opts.name,
      annotations,
    },
    spec: {
      ingressClassName: getIngressClassName(),
      rules: [{ host: opts.host, http: { paths: paths } }],
      tls,
    },
  });
};
