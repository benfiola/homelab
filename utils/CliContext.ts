import { App, Chart } from "cdk8s";
import { Command } from "commander";

export type BootstrapCallback = (app: App) => Promise<Chart>;
export type CommandCallback = (program: Command) => void;
export type ManifestsCallback = (app: App) => Promise<Chart>;
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
