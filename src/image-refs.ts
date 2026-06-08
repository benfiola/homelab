const gameServerImagesTag = "0.2.1";

export const gameServerImage = (name: string) =>
  `ghcr.io/benfiola/game-server-images/${name}:${gameServerImagesTag}`;

const homelabHelperVersion = "10.2.3";

export const homelabHelper = {
  image: `ghcr.io/benfiola/homelab-helper:${homelabHelperVersion}`,
  chart: (chart: string) => ({
    repo: "https://benfiola.github.io/homelab-helper",
    chart,
    version: `v${homelabHelperVersion}`,
  }),
};

export const alpineImage = "alpine:3.23.4";
