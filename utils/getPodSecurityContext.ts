/**
 * Returns a default pod security context.
 *
 * Should be used in conjunction with `getContainerSecurityContext`
 *
 * @param user the non-root user to use (default: 1001)
 * @returns a pod security context
 */
export const getPodSecurityContext = (user?: number) => {
  let _user = user !== undefined ? user : 1001;

  return {
    fsGroup: _user,
    fsGroupChangePolicy: "Always",
    runAsGroup: _user,
    runAsNonRoot: true,
    runAsUser: _user,
    seccompProfile: { type: "RuntimeDefault" },
  };
};
