#!/usr/bin/env tsx
import { ApiObject, Chart, Include, YamlOutputType } from "cdk8s";
import { Command, program } from "commander";
import { configDotenv } from "dotenv";
import { cp, lstat, mkdir, rm, writeFile } from "fs/promises";
import { glob as baseGlob } from "glob";
import path from "path";
import { setTimeout } from "timers";

import { App } from "./utils/App";
import {
  BootstrapCallback,
  CliContext,
  ManifestsCallback,
  ResourcesCallback,
  ResourcesOpts,
} from "./utils/CliContext";
import { getChecksumLabel } from "./utils/createSealedSecret";
import { exec } from "./utils/exec";
import { temporaryDirectory } from "./utils/temporaryDirectory";

const baseFolder = __dirname;

/**
 * Uses 'glob' but returns an iterable of absolute file paths.
 *
 * @param pattern the glob pattern
 * @returns an iterable of file paths
 */
const glob = (pattern: string) => {
  return baseGlob(pattern, { cwd: __dirname }).then((scripts) =>
    scripts.map((s) => path.join(__dirname, s))
  );
};

/**
 * Performs an async sleep
 *
 * @param duration sleep duration
 * @returns
 */
const sleep = (duration: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, duration * 1000));
};

/**
 * Bootstrap deploys an application as part of an initial cluster setup.
 *
 * @param appName the app name
 * @param callback a callback attaching a cdk8s chart to the provided app
 */
async function bootstrap(_: string, callback: BootstrapCallback) {
  const app = new App();
  await callback(app);
  const manifest = app.synthYaml();

  await temporaryDirectory(async (dir) => {
    // generate manifest yaml
    const manifestFile = path.join(dir, "manifest.yaml");
    await writeFile(manifestFile, manifest);

    // apply manifest
    await exec(["kubectl", "apply", `--filename=${manifestFile}`]);
  });
}

/**
 * Generates manifests for all known applications
 *
 * NOTE: see `generateManifest` for details on how manifests are generated
 *
 * @param manifests
 */
async function generateAllManifests(entries: {
  [k: string]: ManifestsCallback;
}) {
  for (const [appName, callback] of Object.entries(entries)) {
    console.log(`generating manifests: ${appName}`);
    await generateManifests(appName, callback);
  }
}

/**
 * Creates a cdk8s app from an existing manifest file
 *
 * @param path path to a manifest
 * @returns an app
 */
const appFromFile = (path: string) => {
  const app = new App();
  const chart = new Chart(app, "chart");
  new Include(chart, "include", { url: path });
  return app;
};

/**
 * Sealed secrets are non-deterministic by design (e.g., sealing the same secret multiple times produces different data).
 *
 * These secrets *should* only change when their source material has changed to allow for easier auditing of manifest changes.
 *
 * This method will merge existing, matching sealed-secrets from `from` to `to` when the checksum for the source input has changed.
 *
 * @param from
 * @param to
 */
const mergeUnchangedSealedSecrets = (from: App, to: App) => {
  const findSealedSecrets = (a: App): { [k: string]: ApiObject } => {
    const data: { [k: string]: ApiObject } = {};
    for (const child of a.node.findAll()) {
      if (!ApiObject.isApiObject(child)) {
        // ignore non-api objects
        continue;
      }
      if (
        child.apiVersion !== "bitnami.com/v1alpha1" ||
        child.kind !== "SealedSecret"
      ) {
        // ignore non-sealed secrets
        continue;
      }
      // store sealed secret by 'namespace/name' key
      const key = `${child!.metadata!.namespace}/${child!.metadata.name}`;
      data[key] = child;
    }
    return data;
  };

  const srcs = findSealedSecrets(from);
  const dests = findSealedSecrets(to);
  for (const [key, src] of Object.entries(srcs)) {
    const dest = dests[key];
    if (dest === undefined) {
      // ignore sealed secrets that no longer exist
      continue;
    }
    const srcHash = (src as any).props.metadata?.labels?.[getChecksumLabel()];
    const destHash = (dest as any).props.metadata?.labels?.[getChecksumLabel()];
    if (
      srcHash === undefined ||
      destHash === undefined ||
      srcHash !== destHash
    ) {
      // ignore sealed secrets with undefined hashes
      // ignore sealed secrets with defined hashes that differ
      continue;
    }
    // sealed-secret content matches - re-use existing data
    (dest as any).props = (src as any).props;
  }
};

/**
 * Delegates to an application with a 'manifest' callback to attach a cdk8s Chart object
 * to a top-level cdk8s App obejct.
 *
 * The parent cdk8s app is then used to synthesize a single manifest for the application
 *
 * @param appName the application name
 * @param callback a callback attaching a cdk8s chart to the provided app
 */
async function generateManifests(appName: string, callback: ManifestsCallback) {
  await temporaryDirectory(async (directory) => {
    const manifestsFolder = path.join(baseFolder, "manifests", appName);

    // create an app and attach chart to it
    const app = new App({
      outdir: directory,
      outputFileExtension: ".yaml",
      yamlOutputType: YamlOutputType.FILE_PER_APP,
    });
    await callback(app);

    const existingManifest = path.join(manifestsFolder, "app.yaml");
    const existingManifestExists = await lstat(existingManifest)
      .then(() => true)
      .catch((e) => false);
    if (existingManifestExists) {
      // if a matching manifest exists, attempt to preserve unchanged sealed secrets
      const existing = appFromFile(existingManifest);
      mergeUnchangedSealedSecrets(existing, app);
    }

    // synthesize yaml
    app.synth();

    // copy created content
    await rm(manifestsFolder, { recursive: true, force: true });
    await mkdir(path.dirname(manifestsFolder), { recursive: true });
    await cp(directory, manifestsFolder, { recursive: true });
  });
}

/**
 * Generates resources for all known applications
 *
 * NOTE: see `generateResources` for details on how manifests are generated
 *
 * @param entries
 */
async function generateAllResources(entries: {
  [k: string]: [ResourcesCallback, ResourcesOpts];
}) {
  for (const [appName, [callback, opts]] of Object.entries(entries)) {
    console.log(`generating resources: ${appName}`);
    await generateResources(appName, callback, opts);
  }
}

/**
 * Delegates to an application to generate importable cdk8s resources
 *
 * @param appName the application name
 * @param callback the callback that produces importable cdk8s resources
 * @param opts (optional) options configuring resource generation behavior
 */
async function generateResources(
  appName: string,
  callback: ResourcesCallback,
  opts?: ResourcesOpts
) {
  const shouldImport =
    opts?.shouldImport !== undefined ? opts.shouldImport : true;

  await temporaryDirectory(async (directory) => {
    // create folder to hold generated cdk8s files
    const outputFolder = path.join(directory, "output");
    await mkdir(outputFolder);

    if (shouldImport) {
      // the callback should produce a manifest file that is imported via cdk8s
      const manifestFile = path.join(directory, "manifest.yaml");
      await callback(manifestFile);
      await exec([
        "yarn",
        "run",
        "cdk8s",
        "import",
        manifestFile,
        "--language",
        "typescript",
        "--output",
        outputFolder,
      ]);
    } else {
      // the callback should directly place cdk8s resources in the output folder
      await callback(outputFolder);
    }

    // copy cdk8s resources to the correct bootstrap folder
    const folder = path.join(baseFolder, "resources", appName);
    await rm(folder, { recursive: true, force: true });
    await mkdir(path.dirname(folder), { recursive: true });
    await cp(outputFolder, folder, { recursive: true });
  });
}

(async function () {
  // load .env file if exists
  configDotenv({ path: ".env" });

  // create top-level (and sub-level) commands
  const cmdBootstrap = program.command("bootstrap");
  const manifestsEntries: { [k: string]: ManifestsCallback } = {};
  const cmdManifests = program.command("manifests");
  cmdManifests
    .command("all")
    .action(() => generateAllManifests(manifestsEntries));
  const resourcesEntries: { [k: string]: [ResourcesCallback, ResourcesOpts] } =
    {};
  const cmdResources = program.command("resources");
  cmdResources
    .command("all")
    .action(() => generateAllResources(resourcesEntries));

  // find all app scripts
  let scripts = await glob("apps/*.ts");
  scripts = scripts.sort();
  for (const script of scripts) {
    // attempt import of app module
    let module;
    try {
      module = await import(script);
    } catch (e) {
      console.warn(`import failed: ${script}`);
      console.error(e);
      continue;
    }

    // parse app name from path
    const appName = path.basename(script, ".ts");

    // obtain root-level, app command as needed
    let cmdApp: Command;

    // create context (used by imported module to register commands and attach callbacks to existing commands)
    const context: CliContext = {
      bootstrap: (callback) => {
        // register new 'bootstrap' subcommand
        cmdBootstrap
          .command(appName)
          .action(() => bootstrap(appName, callback));
      },
      command: (callback) => {
        // allow app to define custom command line tooling
        cmdApp = cmdApp || program.command(appName);
        callback(cmdApp);
      },
      manifests: (callback) => {
        // collect manifests callback for use with `generateAllManifests`
        manifestsEntries[appName] = callback;

        // register new 'manifests' subcommand
        cmdManifests
          .command(appName)
          .action(() => generateManifests(appName, callback));
      },
      resources: (callback, opts?: ResourcesOpts) => {
        // collect resources callback for use with `generateAllResources`
        resourcesEntries[appName] = [callback, opts || {}];

        // register new 'generate resources' subcommand
        cmdResources
          .command(appName)
          .action(() => generateResources(appName, callback, opts));
      },
    };

    // register commands via context
    const register = module.default;
    try {
      register(context);
    } catch (e) {
      console.warn(`cli registration failed: ${script}`);
      console.error(e);
      continue;
    }
  }

  try {
    await program.parseAsync();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
