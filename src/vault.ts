import { writeFile } from "fs/promises";
import zod from "zod";
import { exec } from "./exec";
import { getTempy } from "./tempy";

type EnableSecretsEngineType = "kv2";

interface EnableSecretsEngineOpts {
  description?: string;
}

interface InitOpts {
  keyShares?: number;
  keyThreshold?: number;
}

const authEnginesSchema = zod.record(zod.string(), zod.any());

const policiesSchema = zod.array(zod.string());

const secretsEnginesSchema = zod.record(zod.string(), zod.any());

const initSchema = zod.object({
  unseal_keys_hex: zod.array(zod.string()),
  root_token: zod.string(),
});

const statusSchema = zod.object({
  initialized: zod.boolean(),
  sealed: zod.boolean(),
});

export class Vault {
  address: string;
  token: string;

  constructor(address: string, token: string = "") {
    this.address = address;
    this.token = token;
  }

  getStatus = async () => {
    const command = [
      "vault",
      "status",
      `-address=${this.address}`,
      "-format=json",
    ];
    let output: string;
    try {
      output = await exec(command);
    } catch (e: any) {
      if (e?.code !== 2) {
        throw e;
      }
      output = e.stdout;
    }

    const unparsed = JSON.parse(output);
    const parsed = await statusSchema.parseAsync(unparsed);

    return parsed;
  };

  init = async (opts: InitOpts = {}) => {
    let keyShares = opts.keyShares;
    if (keyShares === undefined) {
      keyShares = 1;
    }
    let keyThreshold = opts.keyThreshold;
    if (keyThreshold === undefined) {
      keyThreshold = 1;
    }

    const command = [
      "vault",
      "operator",
      "init",
      `-address=${this.address}`,
      `-key-shares=${keyShares}`,
      `-key-threshold=${keyThreshold}`,
      "-format=json",
    ];

    const output = await exec(command);

    const unparsed = JSON.parse(output);
    const parsed = await initSchema.parseAsync(unparsed);

    return {
      rootToken: parsed.root_token,
      unsealKey: parsed.unseal_keys_hex[0],
    };
  };

  enableAuthEngine = async (engine: string) => {
    const command = [
      "vault",
      "auth",
      "enable",
      `-address=${this.address}`,
      engine,
    ];

    await exec(command, { env: { VAULT_TOKEN: this.token } });
  };

  getAuthEngines = async () => {
    const command = [
      "vault",
      "auth",
      "list",
      `-address=${this.address}`,
      "-format=json",
    ];

    const output = await exec(command, { env: { VAULT_TOKEN: this.token } });

    const unparsed = JSON.parse(output);
    const parsed = await authEnginesSchema.parseAsync(unparsed);

    return parsed;
  };

  enableSecretsEngine = async (
    path: string,
    type: EnableSecretsEngineType,
    opts: EnableSecretsEngineOpts = {}
  ) => {
    const command = [
      "vault",
      "secrets",
      "enable",
      `-address=${this.address}`,
      `-path=${path}`,
    ];
    if (opts.description) {
      command.push(`-description=${opts.description}`);
    }
    let cmdType: string;
    if (type == "kv2") {
      command.push("-version=2");
      cmdType = "kv";
    } else {
      throw new Error(`Unknown secrets engine type: ${type}`);
    }
    command.push(cmdType);

    await exec(command, { env: { VAULT_TOKEN: this.token } });
  };

  getSecretsEngines = async () => {
    const command = [
      "vault",
      "secrets",
      "list",
      `-address=${this.address}`,
      "-format=json",
    ];

    const output = await exec(command, { env: { VAULT_TOKEN: this.token } });

    const unparsed = JSON.parse(output);
    const parsed = await secretsEnginesSchema.parseAsync(unparsed);

    return parsed;
  };

  listPolicies = async () => {
    const command = [
      "vault",
      "policy",
      "list",
      `-address=${this.address}`,
      "-format=json",
    ];

    const output = await exec(command, { env: { VAULT_TOKEN: this.token } });

    const unparsed = JSON.parse(output);
    const parsed = await policiesSchema.parseAsync(unparsed);

    return parsed;
  };

  putKV = async (mount: string, path: string, data: Record<string, string>) => {
    const tempy = await getTempy();

    await tempy.temporaryFileTask(async (file: string) => {
      const contents = JSON.stringify(data);

      await writeFile(file, contents);

      const command = [
        "vault",
        "kv",
        "put",
        `-address=${this.address}`,
        `-mount=${mount}`,
        path,
        `@${file}`,
      ];

      await exec(command, { env: { VAULT_TOKEN: this.token } });
    });
  };

  writePolicy = async (name: string, policy: string) => {
    const tempy = await getTempy();
    await tempy.temporaryFileTask(async (file) => {
      await writeFile(file, policy);

      const command = [
        "vault",
        "policy",
        "write",
        `-address=${this.address}`,
        name,
        file,
      ];

      await exec(command, { env: { VAULT_TOKEN: this.token } });
    });
  };

  write = async (path: string, data: Record<string, string>) => {
    const command = ["vault", "write", `-address=${this.address}`, path];
    for (const [k, v] of Object.entries(data)) {
      command.push(`${k}=${v}`);
    }

    await exec(command, { env: { VAULT_TOKEN: this.token } });
  };
}
