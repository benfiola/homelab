import { execa } from "execa";
import * as zod from "zod";

const bitwardenItemSchema = zod.object({
  login: zod.object({
    password: zod.string(),
  }),
});

export const getSecret = async (itemId: string): Promise<string> => {
  const result = await execa("bw", ["get", "item", itemId], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
  });
  const bitwardenItem = await bitwardenItemSchema.parseAsync(
    JSON.parse(result.stdout),
  );
  return bitwardenItem.login.password;
};
