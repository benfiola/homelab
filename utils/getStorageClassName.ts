/**
 * Gets a global storage class name mapping to deployed storage controllers.
 *
 * There's an implied tradeoff between replication and performance
 *
 * @param replicated whether to select for replicated or performant storage class
 * @returns a storage class name
 */
export const getStorageClassName = (replicated: boolean = true) => {
  return replicated ? "longhorn" : "openebs-hostpath";
};
