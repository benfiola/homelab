import { App, Chart } from "cdk8s";
import { glob, mkdir } from "fs/promises";
import { join } from "path";
import { AppConfig, AppsConfig } from "./config";
import {
  TemplateAssetFn,
  TemplateChartContext,
  TemplateChartFn,
} from "./context";

const assetsDir = join(__dirname, "..", "assets");
const templatesDir = join(__dirname, "templates");

const getTemplateName = async (templateFile: string) => {
  const parts = templateFile.split("/");
  return parts[parts.length - 2];
};

interface FetchAssetsOpts {
  filter?: string[];
}

export const fetchAssets = async (
  outputPath: string,
  opts: FetchAssetsOpts = {}
) => {
  interface Template {
    assets: TemplateAssetFn;
  }

  const filter = new Set(opts.filter ?? []);

  const sourceAssetPaths: string[] = [];
  for await (const sourceAssetPath of glob(`${templatesDir}/*/asset.ts`)) {
    sourceAssetPaths.push(sourceAssetPath);
  }

  const generateAsset = async (sourceAssetPath: string) => {
    const templateName = await getTemplateName(sourceAssetPath);
    if (filter.size > 0 && !filter.has(templateName)) {
      return;
    }

    const destAssetPath = join(outputPath, templateName);
    await mkdir(destAssetPath, { recursive: true });

    const template: Template = await import(sourceAssetPath);
    await template.assets(destAssetPath);
  };

  await Promise.all(sourceAssetPaths.map(generateAsset));
};

interface AttachChartsOpts {
  filter?: string[];
}

const createGetAsset = (name: string) => {
  return (file: string) => join(assetsDir, name, file);
};

export const attachCharts = async (
  app: App,
  appsConfig: AppsConfig,
  configDir: string,
  opts: AttachChartsOpts = {}
) => {
  const crds = await import("./templates/crds/chart");
  const flux = await import("./templates/flux/chart");

  const filter = new Set(opts.filter ?? []);

  interface Template {
    chart: TemplateChartFn;
  }

  const charts: Chart[] = [];
  const fluxAppsCharts: Chart[] = [];
  const generateChart = async (appConfig: AppConfig) => {
    if (filter.size > 0 && !filter.has(appConfig.id)) {
      return;
    }

    const templatePath = join(templatesDir, appConfig.template, "chart.ts");
    const template: Template = await import(templatePath);

    const context: TemplateChartContext = {
      configDir,
      getAsset: createGetAsset(appConfig.template),
      name: appConfig.template,
      opts: appConfig.options,
    };

    const chart = await template.chart(app, appConfig.id, {
      configDir,
      getAsset: createGetAsset(appConfig.template),
      name: appConfig.template,
      opts: appConfig.options,
    });

    if (!Chart.isChart(chart)) {
      throw new Error(
        `template '${appConfig.template}' did not produce a chart`
      );
    }

    charts.push(chart);
    if (appConfig.flux) {
      fluxAppsCharts.push(chart);
    }

    return chart;
  };

  await Promise.all(appsConfig.map(generateChart));

  const crdChart = await crds.chart(app, "crds", {
    configDir,
    getAsset: createGetAsset("crds"),
    name: "crds",
    opts: { charts: charts },
  });
  fluxAppsCharts.push(crdChart);

  const dependency = (fromStr: string, ...toStrs: string[]) => {
    for (const toStr of toStrs) {
      const from = Chart.of(app.node.findChild(fromStr));
      const to = Chart.of(app.node.findChild(toStr));
      from.addDependency(to);
    }
  };

  for (const appConfig of appsConfig) {
    for (const appDependency of appConfig.dependencies) {
      dependency(appConfig.id, appDependency);
    }
  }

  await flux.chart(app, "flux", {
    configDir,
    getAsset: createGetAsset("flux"),
    opts: { charts: fluxAppsCharts },
    name: "flux",
  });
};
