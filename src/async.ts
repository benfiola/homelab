import pWaitFor from "p-wait-for";

interface WaitForOpts {
  interval?: number;
  timeout?: number;
}

export const waitFor = async <T>(
  fn: () => Promise<T>,
  opts: WaitForOpts = {}
) => {
  let result: T;
  await pWaitFor(
    async () => {
      try {
        result = await fn();
        return true;
      } catch {
        return false;
      }
    },
    {
      interval: (opts.interval ?? 1) * 1000,
      timeout: (opts.timeout ?? 300) * 1000,
    },
  );
  return result!;
};
