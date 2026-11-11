// images shared by several apps (h.images). written as "image:" entries, so renovate finds them
// like any other.
const list = [
  { key: "alpine", image: "alpine:3.24.4" },
  { key: "toolbox", image: "ghcr.io/benfiola/homelab-images/toolbox:1.2.4" },
  { key: "rclone", image: "rclone/rclone:1.76.0" },
] as const;

// an image as the repository and tag values that charts take. it is written whole, as
// h.helmImage("repo/name:tag"), so renovate finds it like any other.
export const helmImage = (ref: string): { repository: string; tag: string } => {
  const colon = ref.lastIndexOf(":");
  if (colon < ref.lastIndexOf("/") || ref.includes("@")) {
    throw new Error(`${ref}: expected 'repo/name:tag'`);
  }
  return { repository: ref.slice(0, colon), tag: ref.slice(colon + 1) };
};

type Images = {
  [entry in (typeof list)[number] as entry["key"]]: entry["image"];
};

export const images = Object.fromEntries(
  list.map((entry) => [entry.key, entry.image]),
) as Images;
