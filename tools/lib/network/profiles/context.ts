import { resolve } from "../template.ts";
import type { Device, Model } from "../model.ts";

type Obj = Record<string, any>;

// what rendering a device has to go on
export interface Context {
  model: Model;
  secrets: Obj;
  // where the scripts are
  scripts: string;
}

export interface Profile {
  // of the file a device renders to
  extension: string;
  render: (device: Device, ctx: Context) => string;
  apply: (content: string, options: Resolved) => Promise<void>;
}

// runs a command, with the given standard input; `interactive` hands it the terminal
export type Run = (
  command: string,
  args: string[],
  options?: { input?: string; interactive?: boolean },
) => Promise<void>;

export interface ApplyOptions {
  address: string;
  user?: string;
  password?: string;
  dryRun?: boolean;
  // routeros: reset the router to this configuration, rather than only copying it
  reset?: boolean;
  run?: Run;
  log?: (message: string) => void;
}

// the options with what a profile relies on filled in
export type Resolved = ApplyOptions & {
  user: string;
  run: Run;
  log: (message: string) => void;
};

export const secret = (ctx: Context, path: string, origin: string): string =>
  String(resolve({ secrets: ctx.secrets }, `secrets.${path}`, origin));

export const upper = (s: string) => s.toUpperCase();

// bfiola-home-laptop -> bfiolaHomeLaptop
export const camel = (s: string) =>
  s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
