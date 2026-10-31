import { defaultUser, profiles } from "./profiles/index.ts";
import type { ApplyOptions } from "./profiles/context.ts";
import { run } from "./profiles/run.ts";
import type { OutputKind } from "./config.ts";

// sends a device the configuration rendered for it
export const applyConfig = async (
  profile: OutputKind,
  content: string,
  options: ApplyOptions,
): Promise<void> => {
  if (profile === "wireguard") {
    throw new Error(
      "a wireguard configuration is imported on the device, not applied",
    );
  }
  await profiles[profile].apply(content, {
    ...options,
    user: options.user ?? defaultUser[profile],
    run: options.run ?? run,
    log: options.log ?? console.log,
  });
};
