import { exec } from "./exec";

export const importResources = async (spec: string, output: string) => {
  await exec([
    "cdk8s",
    "import",
    spec,
    "--language=typescript",
    "--no-class-prefix",
    `--output=${output}`,
  ]);
};

export const importK8s = async (version: string, output: string) => {
  await exec([
    "cdk8s",
    "import",
    `k8s@${version}`,
    "--language=typescript",
    "--no-class-prefix",
    `--output=${output}`,
  ]);
};
