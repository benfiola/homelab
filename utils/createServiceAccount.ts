import { Construct } from "constructs";
import {
  ClusterRole,
  ClusterRoleBinding,
  ClusterRoleProps,
  ServiceAccount,
} from "../resources/k8s/k8s";

type Defined<V extends any> = V extends undefined ? never : V;

type ClusterRoleRule = Defined<ClusterRoleProps["rules"]>[number];

type Verbs = "get" | "list" | "watch" | "patch" | "create" | "edit" | "update";
type Access = { [k: string]: Verbs[] };

/**
 * Resource references convert 'core' api groups to ''.  This method
 * performs this conversion
 *
 * @param value an unprocessed api group value
 * @returns  a processed api group value
 */
const processApiGroup = (value: string) => {
  return value !== "core" ? value : "";
};

/**
 * Converts a simplified representation of a rule (a [string resource, Verbs[]] tuple) into
 * a single ClusterRule rule entry.
 */
const convertRule = ([name, verbs]: [string, Verbs[]]) => {
  let resource = name;
  let apiGroup = "";
  let parts = name.split("/");
  if (parts.length === 2) {
    [apiGroup, resource] = parts;
  } else if (parts.length === 1) {
    [apiGroup, resource] = ["core", parts[0]];
  } else {
    throw new Error(`bad resource: ${name}`);
  }

  const rule: ClusterRoleRule = {
    verbs,
    apiGroups: [processApiGroup(apiGroup)],
    resources: [resource],
  };
  return rule;
};

interface CreateServiceAccountOpts {
  namespace?: string;
  name: string;
  access: Access;
}
/**
 * Creating service accounts often requires the same boilerplate of:
 * - Creating the service account
 * - Creating the cluster role
 * - Creating the cluster role binding
 *
 * This method will create all three and return the resulting service account
 */
export const createServiceAccount = (
  construct: Construct,
  opts: CreateServiceAccountOpts
) => {
  const { namespace, name, access } = opts;

  const serviceAccount = new ServiceAccount(
    construct,
    `${name}-service-account`,
    {
      metadata: {
        namespace,
        name,
      },
    }
  );

  const rules = Object.entries(access).map(convertRule);
  const clusterRole = new ClusterRole(construct, `${name}-cluster-role`, {
    metadata: {
      name,
    },
    rules,
  });

  new ClusterRoleBinding(construct, `${name}-cluster-role-binding`, {
    metadata: {
      name,
    },
    roleRef: {
      apiGroup: processApiGroup(clusterRole.apiGroup),
      kind: clusterRole.kind,
      name: clusterRole.name,
    },
    subjects: [
      {
        kind: serviceAccount.kind,
        apiGroup: processApiGroup(serviceAccount.apiGroup),
        name: serviceAccount.name,
        namespace: serviceAccount.metadata.namespace,
      },
    ],
  });

  return serviceAccount;
};
