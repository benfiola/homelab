#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Command } from "commander";
import { exit, run } from "./lib/cli.ts";
import { run as exec } from "./lib/exec.ts";
import { fluxKustomization } from "./lib/k8s/flux.ts";
import { z } from "./lib/schema.ts";
import { fluxTokenPath, readSecret } from "./lib/secrets/local.ts";
import { readYaml, toYaml } from "./lib/yaml.ts";

// runs the stages of bootstrap.yaml in order

const runStepSchema = z.strictObject({
  command: z.array(z.string()).min(1),
  retry: z.number().optional(),
  requires: z.array(z.string()).optional(),
});

const stageSchema = z
  .strictObject({
    name: z.string().min(1),
    apply: z.array(z.string()).optional(),
    kustomizations: z
      .array(z.strictObject({ name: z.string(), path: z.string() }))
      .optional(),
    serverSide: z.boolean().optional(),
    forceConflicts: z.boolean().optional(),
    run: z.array(runStepSchema).optional(),
  })
  .refine((s) => s.apply?.length || s.kustomizations?.length || s.run?.length, {
    message: "has nothing to do",
  });

const stagesSchema = z
  .strictObject({ stages: z.array(stageSchema).min(1) })
  .refine(
    ({ stages }) => new Set(stages.map((s) => s.name)).size === stages.length,
    { message: "stage names must be unique", path: ["stages"] },
  );

// FLUX_GIT_TOKEN, else the contents of ~/.homelab/flux-git-token, if this machine has one
export const fluxGitToken = (): string | undefined => {
  if (process.env.FLUX_GIT_TOKEN) {
    return process.env.FLUX_GIT_TOKEN;
  }
  const file = fluxTokenPath();
  if (!existsSync(file)) {
    return undefined;
  }
  const token = readSecret(file).trim();
  if (!token) {
    throw new Error(`${file} is empty`);
  }
  return token;
};

export type RunStep = z.output<typeof runStepSchema>;
export type Stage = z.output<typeof stageSchema>;

export interface Step {
  stage: string;
  command: string[];
  input?: string;
  retry?: number;
  requires: string[];
}

// expands ${VAR} and ${VAR:-default} from `env`
export const expand = (text: string, env: Record<string, string | undefined>) =>
  text.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, name, fallback) => {
    const value = env[name] || fallback;
    if (value === undefined) {
      throw new Error(`${name} is not set (in '${text}')`);
    }
    return value;
  });

export const loadStages = (file: string): Stage[] =>
  readYaml(file, stagesSchema).stages;

export interface PlanOpts {
  builtDir: string;
  env: Record<string, string | undefined>;
  from?: string;
  only?: string;
}

export const plan = (stages: Stage[], opts: PlanOpts): Step[] => {
  const known = stages.map((s) => s.name);
  for (const name of [opts.from, opts.only]) {
    if (name && !known.includes(name)) {
      throw new Error(`unknown stage '${name}' (known: ${known.join(", ")})`);
    }
  }

  let selected = stages;
  if (opts.only) {
    selected = stages.filter((s) => s.name === opts.only);
  } else if (opts.from) {
    selected = stages.slice(known.indexOf(opts.from));
  }

  const steps: Step[] = [];
  for (const stage of selected) {
    for (const app of stage.apply ?? []) {
      const command = ["kubectl", "apply"];
      if (stage.serverSide) {
        command.push("--server-side");
        if (stage.forceConflicts) {
          command.push("--force-conflicts");
        }
      }
      command.push("-f", join(opts.builtDir, "apps", app, "manifest.yaml"));
      steps.push({ stage: stage.name, command, requires: [] });
    }
    for (const { name, path } of stage.kustomizations ?? []) {
      steps.push({
        stage: stage.name,
        command: ["kubectl", "apply", "-f", "-"],
        input: toYaml([fluxKustomization(name, path)]),
        requires: [],
      });
    }
    for (const run of stage.run ?? []) {
      steps.push({
        stage: stage.name,
        command: run.command.map((arg) => expand(String(arg), opts.env)),
        retry: run.retry,
        requires: run.requires ?? [],
      });
    }
  }
  return steps;
};

const quote = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg);

const attempt = (step: Step) =>
  exec(step.command[0], step.command.slice(1), {
    input: step.input,
    interactive: step.input === undefined,
  }).then(
    () => true,
    () => false,
  );

const runStep = async (step: Step) => {
  const deadline = Date.now() + (step.retry ?? 0) * 1000;
  for (;;) {
    if (await attempt(step)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    console.log(`    failed; retrying in 5s (until timeout of ${step.retry}s)`);
    await sleep(5000);
  }
};

interface Options {
  file: string;
  built: string;
  from?: string;
  only?: string;
  dryRun?: boolean;
}

const program = new Command()
  .name("bootstrap")
  .description(
    "runs the stages of bootstrap.yaml against the current kubectl context",
  )
  .option("--file <path>", "the stage list", "bootstrap.yaml")
  .option("--built <dir>", "rendered manifests, from `just build`", "out")
  .option("--from <stage>", "start at this stage")
  .option("--only <stage>", "run only this stage")
  .option("--dry-run", "print the commands without running them")
  .action(async (o: Options) => {
    const steps = plan(loadStages(o.file), {
      builtDir: o.built,
      env: process.env,
      from: o.from,
      only: o.only,
    });

    if (!o.dryRun) {
      // fail before touching the cluster
      const missingFiles = steps
        .filter(
          (s) =>
            s.command[0] === "kubectl" &&
            s.command.includes("-f") &&
            s.input === undefined,
        )
        .map((s) => s.command[s.command.length - 1])
        .filter((f) => !existsSync(f));
      if (missingFiles.length > 0) {
        console.error(
          `missing rendered manifests (run \`just build\`):\n  ${missingFiles.join("\n  ")}`,
        );
        return exit(1);
      }
      const token = fluxGitToken();
      if (token) {
        process.env.FLUX_GIT_TOKEN = token;
        // the variable `flux bootstrap github` reads
        process.env.GITHUB_TOKEN = token;
      }
      const missingEnv = [...new Set(steps.flatMap((s) => s.requires))].filter(
        (n) => !process.env[n],
      );
      if (missingEnv.length > 0) {
        console.error(
          `required environment variables are not set: ${missingEnv.join(", ")} (FLUX_GIT_TOKEN can come from ${fluxTokenPath()})`,
        );
        return exit(1);
      }
    }

    let stage = "";
    for (const step of steps) {
      if (step.stage !== stage) {
        stage = step.stage;
        console.log(`\n==> ${stage}`);
      }
      console.log(`  $ ${step.command.map(quote).join(" ")}`);
      if (step.input !== undefined) {
        console.log(step.input.trimEnd().replace(/^/gm, "    | "));
      }
      if (o.dryRun) {
        continue;
      }
      if (!(await runStep(step))) {
        console.error(
          `\nstage '${stage}' failed; fix the problem and resume with: bootstrap --from ${stage}`,
        );
        return exit(1);
      }
    }
  });

if (import.meta.main) {
  await run(program);
}
