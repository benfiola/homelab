type Purpose = "primary" | "backup";

/**
 * Defines a global ingress class name bound to the deployed storage controller
 *
 * @returns the storage class name
 */
export const getStorageClassName = (purpose?: Purpose) => {
  let _purpose = purpose || "primary";
  return _purpose === "primary" ? "lvm-thin" : "lvm-thin-backup";
};
