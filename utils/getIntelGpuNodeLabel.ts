/**
 * Returns a set of node labels indicating that the node has an intel GPU.
 *
 * @returns node labels
 */
export const getIntelGpuNodeLabels = () => {
  return {
    "intel.feature.node.kubernetes.io/gpu": "true",
  };
};
