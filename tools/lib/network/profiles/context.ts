import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { run } from "../../exec.ts";
import type { Device, Model } from "../model.ts";
import { checkTemplate, resolve } from "../template.ts";

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

// replaceable, so that tests can see what would be run
export type Run = typeof run;

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

// a device's script, and where it is named in an error
export const readScript = (device: Device, ctx: Context, extension: string) => {
  const origin = `${device.name}${extension} (${device.script})`;
  const text = readFileSync(join(ctx.scripts, device.script!), "utf-8");
  checkTemplate(text, origin);
  return { origin, text };
};

export const secret = (ctx: Context, path: string, origin: string): string =>
  String(resolve({ secrets: ctx.secrets }, `secrets.${path}`, origin));

// bfiola-home-laptop -> bfiolaHomeLaptop
export const camel = (s: string) =>
  s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
