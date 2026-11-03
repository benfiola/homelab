#!/usr/bin/env node
import { existsSync } from "node:fs";
import { Command, Option } from "commander";
import { align, run } from "./lib/cli.ts";
import { capture } from "./lib/exec.ts";
import {
  readSecret,
  secretPath,
  tokenPath,
  writePrivate,
} from "./lib/secrets/local.ts";
import { project } from "./lib/secrets/bitwarden.ts";

// each secret of the Bitwarden Secrets Manager project is a file, stored whole

const names = ["talos", "network", "apps"];

const name = (value: string) => {
  if (!names.includes(value)) {
    throw new Error(`no secret '${value}' (have: ${names.join(", ")})`);
  }
  return value;
};

const token = (): string => {
  if (process.env.BWS_ACCESS_TOKEN) {
    return process.env.BWS_ACCESS_TOKEN;
  }
  if (existsSync(tokenPath())) {
    return readSecret(tokenPath()).trim();
  }
  throw new Error("no Bitwarden access token: run `just secrets login`");
};

interface Secret {
  id: string;
  key: string;
  value: string;
}

const bws = (args: string[]): Promise<string> =>
  capture("bws", args, {
    env: { ...process.env, BWS_ACCESS_TOKEN: token() },
  });

const list = async (projectId: string): Promise<Secret[]> =>
  JSON.parse(await bws(["secret", "list", projectId]));

// reads a line without showing it when typed, or all of what is piped in
const readHidden = async (prompt: string): Promise<string> => {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let text = "";
    for await (const chunk of stdin) text += chunk;
    return text.trim();
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf-8");
  stdin.resume();
  return new Promise((resolve) => {
    let input = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          done();
          return resolve(input.trim());
        }
        if (char === "\u0003") {
          done();
          process.exit(130);
        }
        input = char === "\u007f" ? input.slice(0, -1) : input + char;
      }
    };
    stdin.on("data", onData);
  });
};

const projectOption = () =>
  new Option("--project <id>", "the Bitwarden Secrets Manager project")
    .env("BWS_PROJECT_ID")
    .default(project);

const program = new Command()
  .name("secrets")
  .description(
    `the secrets this machine holds, in ~/.homelab, and their copies in Bitwarden Secrets Manager: ${names.join(", ")}`,
  )
  .showHelpAfterError();

program
  .command("login")
  .description(
    "save a Bitwarden access token (typed, or piped in) to ~/.homelab, for the commands below",
  )
  .action(async () => {
    const value = await readHidden("Bitwarden Secrets Manager access token: ");
    if (!value) {
      throw new Error("no token given");
    }
    writePrivate(tokenPath(), `${value}\n`);
    console.log(`saved the token to ${tokenPath()}`);
  });

program
  .command("pull")
  .description("write the secrets from Bitwarden to ~/.homelab")
  .argument("[name...]", `default: ${names.join(", ")}`)
  .addOption(projectOption())
  .action(async (given: string[], o: { project: string }) => {
    const wanted = (given.length ? given : names).map(name);
    const secrets = await list(o.project);
    const rows = wanted.map((key) => {
      const secret = secrets.find((s) => s.key === key);
      if (!secret) {
        throw new Error(
          `'${key}' is not in the Bitwarden project ${o.project}`,
        );
      }
      writePrivate(secretPath(key), secret.value);
      return [key, secretPath(key)];
    });
    align(rows).forEach((line) => console.log(line));
  });

program
  .command("push")
  .description(
    "save a secret to Bitwarden from ~/.homelab, or from a file; it is created if it isn't there",
  )
  .argument("<name>", names.join(" or "))
  .argument("[file]", "default: ~/.homelab/<name>.yaml")
  .addOption(projectOption())
  .action(
    async (key: string, file: string | undefined, o: { project: string }) => {
      name(key);
      const value = readSecret(file ?? secretPath(key));
      const existing = (await list(o.project)).find((s) => s.key === key);
      // the value goes to bws as an argument, where other users of this machine could see it
      await bws(
        existing
          ? [
              "secret",
              "edit",
              "--output",
              "none",
              "--value",
              value,
              existing.id,
            ]
          : ["secret", "create", "--output", "none", key, value, o.project],
      );
      console.log(`${existing ? "updated" : "created"} ${key}`);
    },
  );

if (import.meta.main) {
  await run(program);
}
