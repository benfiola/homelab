const version = "6.0.4";

export const homelabHelper = {
  image: `ghcr.io/benfiola/homelab-helper:${version}`,
  chart: (chart: string) => ({
    repo: "https://benfiola.github.io/homelab-helper",
    chart,
    version: `v${version}`,
  }),
};
