/**
 * Returns a default security context for a container.
 * Drops all capabilities and disallows privilege escalation.
 *
 * Should be used in conjunction with `getPodSecurityContext`
 *
 * @returns a container security context
 */
export const getContainerSecurityContext = () => {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
  };
};
