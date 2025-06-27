import { CliContext, ResourcesCallback } from "../utils/CliContext";
import { exec } from "../utils/exec";

const version = "1.32.0";

const resources: ResourcesCallback = async (directory) => {
  await exec([
    "cdk8s",
    "import",
    `k8s@${version}`,
    "--no-class-prefix",
    "--language",
    "typescript",
    "--output",
    directory,
  ]);
};

export default async function (context: CliContext) {
  context.resources(resources, { shouldImport: false });
}
