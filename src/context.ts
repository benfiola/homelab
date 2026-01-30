import { Chart } from "cdk8s";
import { Construct } from "constructs";

export interface TemplateChartContext {
  configDir: string;
  getAsset: (file: string) => string;
  name: string;
  opts: Record<string, any>;
}

export type TemplateChartFn = (
  construct: Construct,
  id: string,
  context: TemplateChartContext
) => Promise<Chart>;

export type TemplateAssetFn = (dir: string) => Promise<void>;
