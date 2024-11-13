type Callback<RV extends any> = (directory: string) => Promise<RV>;

/**
 * Wraps tempy.temporaryDirectoryTask - performing an in-line import to work around
 * import-time issues with the `tempy` package.
 *
 * @param callback the callback to execute with the temporary directory
 * @returns the return value of the callback
 */
export const temporaryDirectory = async <RV extends any>(
  callback: Callback<RV>
): Promise<RV> => {
  const { temporaryDirectoryTask } = await import("tempy");
  return temporaryDirectoryTask(callback);
};
