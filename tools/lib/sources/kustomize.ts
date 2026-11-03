import { dirname } from "node:path";
import { stringify } from "yaml";
import { capture, withTempFile } from "../exec.ts";
import { cacheDir, cacheKey, cachedText } from "./cache.ts";
import { parseManifests } from "./manifest.ts";

type Obj = Record<string, any>;

export interface KustomizeOptions {
  // moves the objects into a namespace, and what refers to them
  namespace?: string;
  // added to every object, and to the selectors and pod templates that match them
  labels?: Record<string, string>;
}

// the objects of an upstream kustomize overlay (e.g. `github.com/org/repo/config/default?ref=v1`) or
// of a manifest at a url, changed by kustomize's own namespace and labels transformers. it is for
// projects that publish their install manifests that way, or need these changes.
export const kustomize = async (
  source: string,
  opts: KustomizeOptions = {},
): Promise<Obj[]> => {
  const kustomization = stringify({
    resources: [source],
    namespace: opts.namespace,
    labels: opts.labels && [
      { pairs: opts.labels, includeSelectors: true, includeTemplates: true },
    ],
  });
  const text = await cachedText(
    cacheDir("kustomize", `${cacheKey(kustomization)}.yaml`),
    () =>
      withTempFile("kustomization.yaml", kustomization, (file) =>
        capture(
          process.env.KUSTOMIZE ?? "kustomize",
          ["build", dirname(file)],
          {
            context: `kustomize build ${source}`,
          },
        ),
      ),
  );
  return parseManifests(text, source);
};
