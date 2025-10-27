import { stringify as yamlStringify } from "yaml";

export const stringify = (...records: Record<any, any>[]) => {
  return records.map((r) => yamlStringify(r)).join("---\n");
};
