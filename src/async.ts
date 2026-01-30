export const sleep = async (duration: number) => {
  return new Promise((resolve) => setTimeout(resolve, duration));
};

interface WaitForOpts {
  interval?: number;
  timeout?: number;
}
export const waitFor = async <T extends any>(
  fn: () => Promise<T>,
  opts: WaitForOpts = {}
) => {
  let interval = opts.interval !== undefined ? opts.interval : 1;
  let timeout = opts.timeout !== undefined ? opts.timeout : 300;
  interval *= 1000;
  timeout *= 1000;

  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      return await fn();
    } catch (e) {}

    await sleep(interval);
  }

  throw new Error(`timed out waiting for condition`);
};
