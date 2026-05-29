import { exec } from "./exec";
import { getTempy } from "./tempy";

export const decrypt = async (
  input: string,
  output: string,
  privateKey: string,
): Promise<void> => {
  const tempy = await getTempy();
  await tempy.temporaryFileTask(async (identityFile) => {
    const { writeFile } = await import("fs/promises");
    await writeFile(identityFile, privateKey);
    await exec([
      "age",
      "--decrypt",
      "--identity",
      identityFile,
      "--output",
      output,
      input,
    ]);
  });
};

export const encrypt = async (
  input: string,
  output: string,
  publicKey: string,
): Promise<void> => {
  await exec([
    "age",
    "--encrypt",
    "--recipient",
    publicKey,
    "--output",
    output,
    input,
  ]);
};
