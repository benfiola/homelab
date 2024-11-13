interface ChartData {
  chart: string;
  repo: string;
  version: string;
}

/**
 * Generating resources often calls out to `helm template` to obtain a manifest that's imported by cdk8s.
 * Because it's so common, this method will generate that command from common helm chart metadata
 *
 * @param data helm chart metadata
 * @returns string[] containing helm template command
 */
export const getHelmTemplateCommand = (data: ChartData) => {
  return [
    "helm",
    "template",
    data.chart,
    "--include-crds",
    `--repo=${data.repo}`,
    `--version=${data.version}`,
  ];
};
