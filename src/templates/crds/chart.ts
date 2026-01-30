import { ApiObject } from "cdk8s";
import zod from "zod";
import { Chart } from "../../cdk8s";
import { TemplateChartFn } from "../../context";

const optsSchema = zod.object({
  charts: zod.array(zod.custom<Chart>()),
});

export const chart: TemplateChartFn = async (construct, _, context) => {
  const opts = await optsSchema.parseAsync(context.opts);

  const chart = new Chart(construct, context.name);

  const crds: ApiObject[] = [];
  for (const c of opts.charts) {
    for (const obj of c.node.findAll()) {
      if (!ApiObject.isApiObject(obj)) {
        continue;
      }

      if (obj.kind !== "CustomResourceDefinition") {
        continue;
      }

      const parent = obj.node.scope;
      if (!parent) {
        throw new Error(`node ${obj.node.id} has no parent`);
      }

      const success = parent.node.tryRemoveChild(obj.node.id);
      if (!success) {
        throw new Error(`node ${obj.node.id} did not delete`);
      }

      crds.push(obj);
    }
  }

  crds.sort((a, b) => a.node.id.localeCompare(b.node.id));

  const processed = new Set<string>();
  for (const crd of crds) {
    if (processed.has(crd.name)) {
      continue;
    }
    processed.add(crd.name);

    new ApiObject(chart, crd.name, (crd as any).props);
  }

  return chart;
};
