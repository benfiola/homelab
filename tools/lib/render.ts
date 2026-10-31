import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { App } from "./app.ts";
import { stampNamespace, tidy, validate } from "./finalize.ts";

type Obj = Record<string, any>;

// the objects of an app: what its `app.ts` creates through the `App` handle (see app.ts) and returns,
// made ready to publish
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
  const objects = validate(module, [
    ...(await h.objects()),
    ...(returned ?? []),
  ]);
  return stampNamespace(tidy(objects), h.namespaceName);
};
