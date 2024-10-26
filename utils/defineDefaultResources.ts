import { Construct } from "constructs";

/**
 * Gives constructs the ability to opt-out of automatic resource requests/limits
 * definitions.
 *
 * This is an escape hatch in the very uncommon case where the default values are insufficient
 * *and* the construct in question offers no ability to customize the requests/resources (see `longhorn`).
 *
 * @param obj
 */
export const disableDefineDefaultResources = (obj: Construct) => {
  (obj as any)[key] = false;
};

/**
 * Enumerates the tree of constructs attached to `obj` - returning true if
 * any construct has default resources disabled.
 *
 * Otherwise, returns true.
 *
 * @param obj the object
 * @returns a boolean indicating that default resources should/should not be defined
 */
export const isDefineDefaultResourcesDisabled = (obj: Construct) => {
  let curr: Construct | undefined = obj;
  while (curr !== undefined) {
    if ((curr as any)[key] === false) {
      return true;
    }
    curr = curr.node.scope;
  }
  return false;
};

const key = "defuleDefaultResources";
