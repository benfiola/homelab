import { writeFile } from "fs/promises";
import zod from "zod";
import { exec, ExecError } from "./exec";
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

  private cmd(...args: string[]) {
    return ["vault", ...args, `-address=${this.address}`];
  }

  private env() {
    return { VAULT_TOKEN: this.token };
  }

  getStatus = async () => {
    let output: string;
    try {
      output = await exec(this.cmd("status", "-format=json"));
    } catch (e) {
      if (!(e instanceof ExecError) || e.exitCode !== 2) {
        throw e;
      }
      output = e.stdout;
    }

    return statusSchema.parseAsync(JSON.parse(output));
  };

  init = async (opts: InitOpts = {}) => {
    const keyShares = opts.keyShares ?? 1;
    const keyThreshold = opts.keyThreshold ?? 1;

    const output = await exec(
      this.cmd(
        "operator",
        "init",
        `-key-shares=${keyShares}`,
        `-key-threshold=${keyThreshold}`,
        "-format=json",
      ),
    );

    const parsed = await initSchema.parseAsync(JSON.parse(output));
    return {
      rootToken: parsed.root_token,
      unsealKey: parsed.unseal_keys_hex[0],
    };
  };

  enableAuthEngine = async (engine: string) => {
    await exec(this.cmd("auth", "enable", engine), { env: this.env() });
  };

  getAuthEngines = async () => {
    const output = await exec(this.cmd("auth", "list", "-format=json"), {
      env: this.env(),
    });
    return authEnginesSchema.parseAsync(JSON.parse(output));
  };

  enableSecretsEngine = async (
    path: string,
    type: EnableSecretsEngineType,
    opts: EnableSecretsEngineOpts = {},
  ) => {
    const args = ["secrets", "enable", `-path=${path}`];
    if (opts.description) {
      args.push(`-description=${opts.description}`);
    }
    if (type === "kv2") {
      args.push("-version=2", "kv");
    } else {
      throw new Error(`Unknown secrets engine type: ${type}`);
    }
    await exec(this.cmd(...args), { env: this.env() });
  };

  getSecretsEngines = async () => {
    const output = await exec(
      this.cmd("secrets", "list", "-format=json"),
      { env: this.env() },
    );
    return secretsEnginesSchema.parseAsync(JSON.parse(output));
  };

  listPolicies = async () => {
    const output = await exec(
      this.cmd("policy", "list", "-format=json"),
      { env: this.env() },
    );
    return policiesSchema.parseAsync(JSON.parse(output));
  };

  putKV = async (mount: string, path: string, data: Record<string, string>) => {
    const tempy = await getTempy();
    await tempy.temporaryFileTask(async (file: string) => {
      await writeFile(file, JSON.stringify(data));
      await exec(
        this.cmd("kv", "put", `-mount=${mount}`, path, `@${file}`),
        { env: this.env() },
      );
    });
  };

  writePolicy = async (name: string, policy: string) => {
    const tempy = await getTempy();
    await tempy.temporaryFileTask(async (file: string) => {
      await writeFile(file, policy);
      await exec(this.cmd("policy", "write", name, file), { env: this.env() });
    });
  };

  write = async (path: string, data: Record<string, string>) => {
    const kvArgs = Object.entries(data).map(([k, v]) => `${k}=${v}`);
    await exec(this.cmd("write", path, ...kvArgs), { env: this.env() });
  };
}
