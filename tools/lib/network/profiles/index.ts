import type { ProfileName } from "../model.ts";
import type { Profile } from "./context.ts";
import { openwrt } from "./openwrt.ts";
import { routeros } from "./routeros.ts";
import { swos } from "./swos/index.ts";

export const profiles: Record<ProfileName, Profile> = {
  routeros,
  openwrt,
  swos,
};

export const defaultUser: Record<ProfileName, string> = {
  routeros: "admin",
  openwrt: "root",
  swos: "admin",
};
