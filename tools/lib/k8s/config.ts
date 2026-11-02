type Obj = Record<string, any>;

export const configMap = (name: string, data: Record<string, string>): Obj => ({
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: { name },
  data,
});
