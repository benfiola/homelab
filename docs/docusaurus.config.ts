import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "Homelab",
  tagline: "Infrastructure-as-code for a cluster-in-closet",

  future: {
    v4: true,
  },

  url: "https://benfiola.github.io",
  baseUrl: "/homelab/",

  organizationName: "benfiola",
  projectName: "homelab",
  trailingSlash: false,

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        blog: false,
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: ["docusaurus-plugin-image-zoom"],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Homelab",
      items: [
        {
          href: "https://github.com/benfiola/homelab",
          label: "Code",
          position: "right",
        },
      ],
      logo: {
        src: "/img/icon.png",
      },
    },
    footer: {},
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash"],
    },
    zoom: {
      selector: ".markdown img.zoom",
      background: {
        light: "rgb(255, 255, 255)",
        dark: "rgb(50, 50, 50)",
      },
      config: {},
    },
  } satisfies Preset.ThemeConfig,

  markdown: {
    mermaid: true,
  },

  themes: ["@docusaurus/theme-mermaid"],
};

export default config;
