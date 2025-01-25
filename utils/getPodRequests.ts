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
  let data: Record<string, Record<string, string>> = {
    limits: {
      memory: `${mem}Mi`,
    },
    requests: {
      cpu: `${cpu}m`,
      memory: `${mem}Mi`,
    },
  };
  if (opts?.ephemeralStorage !== undefined) {
    const ephemeralStorage = opts?.ephemeralStorage;
    data.limits["ephemeral-storage"] = `${ephemeralStorage}Mi`;
    data.requests["ephemeral-storage"] = `${ephemeralStorage}Mi`;
  }
  return data;
};
