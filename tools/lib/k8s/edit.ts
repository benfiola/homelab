type Obj = Record<string, any>;

// picks out objects of an app
export interface Selector {
  kind: string;
  name: string;
  // api group, for kinds that exist in several
  group?: string;
  namespace?: string;
}

// what a `postRender` hook edits the app's built objects with. every method fails with a message
// that says what was missing, so that a changed upstream is noticed
export interface Editor {
  // the one object matching the selector
  find(selector: Selector): Obj;
  // every object matching the selector (at least one)
  findAll(selector: Selector): Obj[];
  // a container of a workload's pod template
  container(workload: Obj, name: string): Obj;
  // the item of a list satisfying a predicate; `what` describes it, for the error
  item<T>(list: T[], predicate: (item: T) => boolean, what: string): T;
  // replaces a list item with another
  replace<T>(list: T[], from: T, to: T): void;
}

const describe = ({ kind, name, group, namespace }: Selector) =>
  `${group ? `${group}/` : ""}${kind}/${name}${namespace ? ` in ${namespace}` : ""}`;

const label = (obj: Obj) => `${obj.kind}/${obj.metadata?.name}`;

// the pod template of a workload, whether it is made by the workload or by a job template
const podSpec = (workload: Obj): Obj | undefined =>
  workload.spec?.template?.spec ??
  workload.spec?.jobTemplate?.spec?.template?.spec;

export const editor = (objects: Obj[]): Editor => {
  const findAll = (selector: Selector): Obj[] => {
    const matches = objects.filter(
      (obj) =>
        obj.kind === selector.kind &&
        obj.metadata?.name === selector.name &&
        (selector.group === undefined ||
          String(obj.apiVersion).split("/")[0] === selector.group) &&
        (selector.namespace === undefined ||
          obj.metadata?.namespace === selector.namespace),
    );
    if (matches.length === 0) {
      throw new Error(`no object matches ${describe(selector)}`);
    }
    return matches;
  };

  return {
    find: (selector) => {
      const matches = findAll(selector);
      if (matches.length > 1) {
        throw new Error(
          `${matches.length} objects match ${describe(selector)}: select one, or use findAll`,
        );
      }
      return matches[0];
    },

    findAll,

    container: (workload, name) => {
      const spec = podSpec(workload);
      if (!spec) {
        throw new Error(`${label(workload)} has no pod template`);
      }
      const found = (spec.containers ?? []).find((c: Obj) => c.name === name);
      if (!found) {
        throw new Error(`${label(workload)} has no container '${name}'`);
      }
      return found;
    },

    item: (list, predicate, what) => {
      const found = list.find(predicate);
      if (found === undefined) {
        const names = list.flatMap((i: any) => (i?.name ? [i.name] : []));
        throw new Error(
          `no ${what}${names.length ? ` (have: ${names.join(", ")})` : ""}`,
        );
      }
      return found;
    },

    replace: (list, from, to) => {
      const index = list.indexOf(from);
      if (index < 0) {
        throw new Error(`expected '${from}' in ${JSON.stringify(list)}`);
      }
      list[index] = to;
    },
  };
};
