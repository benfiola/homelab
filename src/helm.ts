import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { exec } from "./exec";
import { getTempy } from "./tempy";
import { stringify } from "./yaml";

const extractChartName = (chart: string) => {
  const chartName = chart.split("/").pop();
  if (chartName === undefined) {
    throw new Error(`failed to extract chart name from ${chart}`);
  }
  return chartName;
};

interface PullChartRef {
  chart: string;
  repo?: string;
  version: string;
}

export const pull = async (chartRef: PullChartRef, output: string) => {
  const command = ["helm", "pull", chartRef.chart, `--destination=${output}`];
  if (chartRef.repo !== undefined) {
    command.push(`--repo=${chartRef.repo}`);
  }
  if (chartRef.version !== undefined) {
    command.push(`--version=${chartRef.version}`);
  }

  await exec(command);

  const chartName = extractChartName(chartRef.chart);
  const chartFile = `${chartName}-${chartRef.version}.tgz`;
  const chartPath = join(output, chartFile);
  if (!existsSync(chartPath)) {
    throw new Error(`pulled chart not found ${chartPath}`);
  }

  return chartPath;
};

interface TemplateOpts {
  helmFlags?: string[];
  chart: string;
  values?: Record<string, any>;
}

export const template = async (opts: TemplateOpts) => {
  const command = ["helm", "template", opts.chart];
  if (opts.helmFlags !== undefined) {
    command.push(...opts.helmFlags);
  }

  let manifest = "";
  const tempy = await getTempy();
  await tempy.temporaryDirectoryTask(async (dir: string) => {
    if (opts.values !== undefined) {
      const valuesPath = join(dir, "values.yaml");
      await writeFile(valuesPath, stringify(opts.values));
      command.push(`--values=${valuesPath}`);
    }
    manifest = await exec(command);
  });

  return manifest;
};
