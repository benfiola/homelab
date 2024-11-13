interface Opts {
  cpu?: number;
  mem?: number;
}

/**
 * Returns a set of pod request values
 *
 * @returns pod request values
 */
export const getPodRequests = (opts?: Opts) => {
  const cpu = opts?.cpu !== undefined ? opts.cpu : 100;
  const mem = opts?.mem !== undefined ? opts.mem : 100;
  return {
    limits: {
      memory: `${mem}Mi`,
    },
    requests: {
      cpu: `${cpu}m`,
      memory: `${mem}Mi`,
    },
  };
};
