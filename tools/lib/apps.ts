import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FluxDeclaration } from "./k8s/flux.ts";
import type { NetworkFunction } from "./k8s/network-policy.ts";

// the generated app that publishes every app's crds
export const crdsApp = "crds";

export const listApps = (appsDir: string) =>
  readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

// an app's `export const flux`, read without running the app. the generated crds app has none.
export const fluxDeclaration = async (
  appsDir: string,
  app: string,
): Promise<FluxDeclaration | undefined> => {
  if (app === crdsApp) {
    return undefined;
  }
  const module = await import(pathToFileURL(join(appsDir, app, "app.ts")).href);
  return module.flux;
};

// an app's `export const network`, read without running the app. the generated crds app has none.
export const networkFunction = async (
  appsDir: string,
  app: string,
): Promise<NetworkFunction | undefined> => {
  if (app === crdsApp) {
    return undefined;
  }
  const path = join(appsDir, app, "app.ts");
  const module = await import(pathToFileURL(path).href);
  if (module.network !== undefined && typeof module.network !== "function") {
    throw new Error(`${path}: 'network' must be a function`);
  }
  return module.network;
};
