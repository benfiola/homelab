// images shared by several apps (`h.images`). written as `image:` entries, so renovate finds them
// like any other.
const list = [
  { key: "alpine", image: "alpine:3.23.4" },
  { key: "toolbox", image: "ghcr.io/benfiola/homelab-images/toolbox:1.2.3" },
  { key: "rclone", image: "rclone/rclone:1.75.2" },
] as const;

type Images = {
  [entry in (typeof list)[number] as entry["key"]]: entry["image"];
};

export const images = Object.fromEntries(
  list.map((entry) => [entry.key, entry.image]),
) as Images;
