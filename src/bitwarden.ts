import { execa } from "execa";

/**
 * Bitwarden Secrets Manager API client using bws CLI.
 * Assumes authenticated session via BWS_ACCESS_TOKEN environment variable.
 */

export interface BSMSecret {
  id: string;
  key: string;
  value: string;
  projectId: string;
}

/**
 * Fetch all secrets from a BSM project.
 * @param projectUuid - BSM project UUID
 */
export const listSecrets = async (
  projectUuid: string,
): Promise<BSMSecret[]> => {
  const result = await execa("bws", ["secret", "list", projectUuid], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
  });

  return JSON.parse(result.stdout) as BSMSecret[];
};

/**
 * Fetch a secret value from BSM by project UUID and secret key.
 * Lists all secrets in the project and filters by key.
 * @param projectUuid - BSM project UUID
 * @param secretKey - Secret key name (e.g., "storage", "apps", "flux", etc.)
 */
export const getSecret = async (
  projectUuid: string,
  secretKey: string,
): Promise<string> => {
  const secrets = await listSecrets(projectUuid);
  const secret = secrets.find((s) => s.key === secretKey);

  if (!secret) {
    throw new Error(
      `Secret '${secretKey}' not found in project '${projectUuid}'`,
    );
  }

  return secret.value;
};

/**
 * Upload or update a secret in BSM.
 * Creates the secret if it doesn't exist, otherwise updates it.
 * @param projectUuid - BSM project UUID
 * @param secretKey - Secret key name (e.g., "storage", "apps", etc.)
 * @param secretValue - Secret value (will be stored as-is)
 */
export const putSecret = async (
  projectUuid: string,
  secretKey: string,
  secretValue: string,
): Promise<void> => {
  // Fetch all secrets to find the one with this key
  const secrets = await listSecrets(projectUuid);
  const secret = secrets.find((s) => s.key === secretKey);
  if (!secret) {
    throw new Error(`secret '${secretKey}' not found`);
  }

  await execa(
    "bws",
    ["secret", "edit", "--output", "none", "--value", secretValue, secret.id],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
};
