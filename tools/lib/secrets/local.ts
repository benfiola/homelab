import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// where this machine keeps its secrets: outside the repository
export const homelabDir = () =>
  process.env.HOMELAB_DIR ?? join(homedir(), ".homelab");

export const secretPath = (name: string) => join(homelabDir(), `${name}.yaml`);

export const tokenPath = () => join(homelabDir(), "bws-token");

// a secrets file is for its owner alone, as ssh insists of a private key
export const checkPrivate = (file: string): string => {
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `${file} has mode ${mode.toString(8)}: it must be readable by its owner only (chmod 600 ${file})`,
    );
  }
  return file;
};

export const readSecret = (file: string): string => {
  if (!existsSync(file)) {
    throw new Error(`no such secrets file: ${file}`);
  }
  return readFileSync(checkPrivate(file), "utf-8");
};

// the secrets file a tool was given, else the one this machine holds under `name`, if there is one
export const secretsFile = (
  given: string | undefined,
  name: string,
): string | undefined => {
  if (given) {
    readSecret(given);
    return given;
  }
  return existsSync(secretPath(name))
    ? checkPrivate(secretPath(name))
    : undefined;
};

export const writePrivate = (file: string, content: string) => {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (dir === homelabDir()) {
    chmodSync(dir, 0o700);
  }
  // the mode of writeFileSync is only for a file that is created
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
};
