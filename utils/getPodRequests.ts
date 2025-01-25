interface Opts {
  cpu?: number;
  mem?: number;
  ephemeralStorage?: number;
}

/**
 * Returns a set of pod request values
 *
 * @returns pod request values
 */
export const getPodRequests = (opts?: Opts) => {
  const cpu = opts?.cpu !== undefined ? opts.cpu : 100;
  const mem = opts?.mem !== undefined ? opts.mem : 100;
  const ephemeralStorage =
    opts?.ephemeralStorage !== undefined ? opts.ephemeralStorage : undefined;
  return {
    limits: {
      memory: `${mem}Mi`,
      "ephemeral-storage": `${ephemeralStorage}Mi`,
    },
    requests: {
      cpu: `${cpu}m`,
      memory: `${mem}Mi`,
      "ephemeral-storage": `${ephemeralStorage}Mi`,
    },
  };
};
