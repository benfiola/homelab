/**
 * Returns the cert-manager cluster issuer annotation so that kubernetes resources like Ingress
 * can leverage TLS with a common issuer.
 *
 * @returns the cluster issuer annotations
 */
export const getCertIssuerAnnotations = () => ({
  "cert-manager.io/cluster-issuer": "cloudflare",
});
