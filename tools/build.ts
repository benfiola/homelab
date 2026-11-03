#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { App } from "./lib/app.ts";
import { crdsApp, listApps } from "./lib/apps.ts";
import { exit, run } from "./lib/cli.ts";
import { canonical } from "./lib/object.ts";
import { toYaml } from "./lib/yaml.ts";

type Obj = Record<string, any>;

// fifo keeps the rendered resource order, which flux applies in order
const outputKustomization = `resources:
  - manifest.yaml
sortOptions:
  order: fifo
`;

// the objects of an app: what its `app.ts` creates through the `App` handle (see app.ts) and returns
export const renderApp = async (dir: string): Promise<Obj[]> => {
  const module = join(dir, "app.ts");
  const imported = await import(pathToFileURL(module).href);
  if (typeof imported.app !== "function") {
    throw new Error(`${module}: expected an export named 'app' (a function)`);
  }

  const h = new App(basename(dir), dir);
  const returned = await imported.app(h);
  if (returned !== undefined && !Array.isArray(returned)) {
    throw new Error(
      `${module}: 'app' must return nothing, or an array of objects`,
    );
  }
  h.add(...(returned ?? []));
  return h.objects();
};

const splitCrds = (objects: Obj[]) => {
  const rest: Obj[] = [];
  const crds: Obj[] = [];
  for (const obj of objects) {
    (obj.kind === "CustomResourceDefinition" ? crds : rest).push(obj);
  }
  return { rest, crds };
};

export interface BuildOpts {
  appsDir: string;
  outDir: string;
  concurrency?: number;
}

export interface BuildFailure {
  app: string;
  message: string;
}

export interface BuildResult {
  built: number;
  failures: BuildFailure[];
  crds: {
    total: number;
    // crds that two apps ship with different content; the app that sorts last wins
    conflicts: string[];
  };
}

interface AppOutput {
  rest: Obj[];
  crds: Obj[];
}

const buildApp = async (app: string, opts: BuildOpts): Promise<AppOutput> => {
  if (app === crdsApp) {
    throw new Error(
      `apps/${crdsApp} is generated from the crds of every other app: remove it`,
    );
  }
  const dir = join(opts.appsDir, app);
  if (!existsSync(join(dir, "app.ts"))) {
    throw new Error(`apps/${app} has no app.ts`);
  }
  return splitCrds(await renderApp(resolve(dir)));
};

const writeApp = (outDir: string, app: string, objects: Obj[]) => {
  const dest = join(outDir, "apps", app);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "manifest.yaml"), toYaml(objects));
  writeFileSync(join(dest, "kustomization.yaml"), outputKustomization);
};

// builds every app into <outDir>/apps/<app>/, replacing <outDir>/apps. crds are pulled out of every
// app into one deduplicated `crds` app.
export const build = async (opts: BuildOpts): Promise<BuildResult> => {
  const apps = listApps(opts.appsDir);
  rmSync(join(opts.outDir, "apps"), { recursive: true, force: true });

  const outputs = new Map<string, AppOutput>();
  const failures: BuildFailure[] = [];
  const queue = [...apps];
  const worker = async () => {
    for (let app = queue.shift(); app; app = queue.shift()) {
      try {
        outputs.set(app, await buildApp(app, opts));
      } catch (e: any) {
        failures.push({ app, message: String(e.stderr || e.message).trim() });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(opts.concurrency ?? 4, apps.length) },
      worker,
    ),
  );

  // crds of every app, in the order of the apps' names; duplicates must not differ
  const crds = new Map<string, Obj>();
  const conflicts: string[] = [];
  for (const app of [...outputs.keys()].sort()) {
    for (const crd of outputs.get(app)!.crds) {
      // deployed crds are in the namespace `crds`: a different one changes flux's inventory id, and flux
      // would prune them (and every custom resource) as stale.
      crd.metadata = { ...crd.metadata, namespace: crdsApp };
      const existing = crds.get(crd.metadata.name);
      if (existing && canonical(existing) !== canonical(crd)) {
        conflicts.push(crd.metadata.name);
      }
      crds.set(crd.metadata.name, crd);
    }
  }

  for (const [app, output] of outputs) {
    writeApp(opts.outDir, app, output.rest);
  }
  if (crds.size > 0) {
    const sorted = [...crds.values()].sort((a, b) =>
      a.metadata.name.localeCompare(b.metadata.name),
    );
    writeApp(opts.outDir, crdsApp, sorted);
  }

  return {
    built: outputs.size,
    failures,
    crds: { total: crds.size, conflicts: conflicts.sort() },
  };
};

const program = new Command()
  .name("build")
  .description(
    "renders every apps/<name>/app.ts into <out>/apps/<name>/{manifest.yaml,kustomization.yaml}, the layout flux reads from the manifests repo. crds are pulled out of every app into <out>/apps/crds.",
  )
  .option("--out <dir>", "output directory, whose apps/ is replaced", "out")
  .action(async ({ out }: { out: string }) => {
    const result = await build({ appsDir: "apps", outDir: out });

    for (const failure of result.failures) {
      console.error(`FAIL  ${failure.app}\n${failure.message}\n`);
    }
    if (result.crds.conflicts.length > 0) {
      console.warn(
        `warning: ${result.crds.conflicts.length} crds differ from apps/crds (the app's version is used): ${result.crds.conflicts.join(", ")}`,
      );
    }
    console.log(
      `built ${result.built} apps into ${out}/apps (${result.crds.total} crds), ${result.failures.length} failed`,
    );
    exit(result.failures.length === 0 ? 0 : 1);
  });

if (import.meta.main) {
  await run(program);
}
