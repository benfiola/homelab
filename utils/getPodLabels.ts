/**
 * Returns a set of common pod labels.
 *
 * @param podName the pod name
 * @returns pod labels
 */
export const getPodLabels = (podName: string) => {
  return {
    "bfiola.dev/pod-name": podName,
  };
};
