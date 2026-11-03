import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// whether a program is installed, for tests that skip without it
export const hasCommand = (command: string): boolean =>
  spawnSync(command, ["--help"], { stdio: "ignore" }).error === undefined;

// serves files (by name) over http, for what is fetched by url
export const serve = async (files: Record<string, string>) => {
  const server = createServer((request, response) => {
    const content = files[request.url!.slice(1)];
    response.statusCode = content === undefined ? 404 : 200;
    response.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (name: string) => `http://127.0.0.1:${port}/${name}`,
    close: () => server.close(),
  };
};
