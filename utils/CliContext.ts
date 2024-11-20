import { App, Chart } from "cdk8s";
import { Command } from "commander";

/**
 * A BootstrapCallback expects an implementation that:
 * - Creates a `Chart` attached to the `App`
 * - Attaches cdk8s resources to the `Chart`
 * - Returns the `Chart`
 * This chart is then rendered into a manifest and applied to the active kubernetes context
 */
export type BootstrapCallback = (app: App) => Promise<Chart>;

/**
 * A CommandCallback expects an implementation that attaches subcommands to the given `program`.
 *
 * See: https://github.com/tj/commander.js
 */
export type CommandCallback = (program: Command) => void;

/**
 * A ManifestsCallback expects an implementation that:
 * - Creates a `Chart` attached to the `App`
 * - Attaches cdk8s resources to the `Chart`
 * - Returns the `Chart`
 * This chart is then rendered into a manifest and written to <root>/manifests/<app>/app.yaml
 */
export type ManifestsCallback = (app: App) => Promise<Chart>;

/**
 * A ResourcesCallback expects an implementation that:
 * - Obtains a manifest containing at least one CustomResourceDefinition
 * - Writing the manifest to `path`
 * `path` is then piped to `cdk8s import` and its output is written to <root>/resources/<app>/*
 * These resources can *then* be imported and used by other apps to produce cdk8s-backed custom resources.
 */
export type ResourcesCallback = (path: string) => Promise<void>;
export interface ResourcesOpts {
  shouldImport?: boolean;
}

/**
 * A context provided to each script within the `apps` folder.
 *
 * Allows applications to attach to known commands, and register new sub-commands.
 */
export interface CliContext {
  bootstrap: (callback: BootstrapCallback) => void;
  command: (callback: CommandCallback) => void;
  manifests: (callback: ManifestsCallback) => void;
  resources: (callback: ResourcesCallback, opts?: ResourcesOpts) => void;
}
