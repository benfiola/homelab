/**
 * Defines a global ingress class name bound to the deployed ingress controller
 *
 * @returns the ingress class name
 */
export const getIngressClassName = () => {
  return "cilium";
};
