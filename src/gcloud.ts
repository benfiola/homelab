import { parse } from "yaml";
import { exec } from "./exec";

interface AuthList {
  account: string;
  status: "ACTIVE" | "";
}

const isAuthenticated = async () => {
  const authListStr = await exec(["gcloud", "auth", "list", "--format=yaml"]);
  let authList: AuthList | AuthList[] = parse(authListStr);
  if (authList === null) {
    authList = [];
  }
  if (!Array.isArray(authList)) {
    authList = [authList];
  }
  const active = authList.find((a) => a.status === "ACTIVE");
  return active !== undefined;
};

export const login = async () => {
  if (!(await isAuthenticated())) {
    await exec(["gcloud", "auth", "login"], { output: "inherit" });
  }
};

interface CopyOpts {
  recursive?: boolean;
}

export const copy = async (
  source: string,
  destination: string,
  opts: CopyOpts = {}
) => {
  let command = ["gcloud", "storage", "cp"];
  if (opts.recursive) {
    command.push("-r");
  }
  command.push(source, destination);
  await exec(command);
};
