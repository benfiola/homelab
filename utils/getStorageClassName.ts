type Purpose = "primary" | "backup";

/**
 * Defines a global storage class name bound to the deployed storage controller
 *
 * @returns the storage class name
 */
export const getStorageClassName = (purpose?: Purpose) => {
  let _purpose = purpose || "primary";
  if (_purpose === "primary") {
    return "piraeus";
  } else if (_purpose === "backup") {
    return "piraeus-backup";
  }
  throw new Error(`unknown storage purpose: ${purpose}`);
};
