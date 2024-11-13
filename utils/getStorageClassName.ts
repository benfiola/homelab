/**
 * Defines a global ingress class name bound to the deployed storage controller
 *
 * @returns the storage class name
 */
export const getStorageClassName = () => {
  return "linstor";
};
