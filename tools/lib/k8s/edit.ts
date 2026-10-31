type Obj = Record<string, any>;

export const container = (workload: Obj, name: string): Obj => {
  const found = workload.spec.template.spec.containers.find(
    (c: Obj) => c.name === name,
  );
  if (!found) {
    throw new Error(
      `${workload.kind}/${workload.metadata.name} has no container '${name}'`,
    );
  }
  return found;
};

// replaces a list entry; fails if there is none, so a changed upstream is noticed
export const replace = <T>(list: T[], from: T, to: T): void => {
  const index = list.indexOf(from);
  if (index < 0) {
    throw new Error(`expected '${from}' in ${JSON.stringify(list)}`);
  }
  list[index] = to;
};
