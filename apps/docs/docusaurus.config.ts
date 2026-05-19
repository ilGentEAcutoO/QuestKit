import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "QuestKit",
  tagline: "Cloudflare-native gamification SDK",
  favicon: "img/favicon.svg",

  url: "https://docs.questkit.jairukchan.com",
  baseUrl: "/",

  organizationName: "ilGentEAcutoO",
  projectName: "QuestKit",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // Custom plugin wires Tailwind v4's PostCSS plugin into Docusaurus's build
  // chain. See src/plugins/tailwind-plugin.js — this is the canonical 2026
  // integration path; we intentionally do NOT ship a standalone
  // postcss.config.js (Docusaurus owns the bundler config).
  plugins: ["./src/plugins/tailwind-plugin.js"],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl:
            "https://github.com/ilGentEAcutoO/QuestKit/tree/main/apps/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/questkit-social-card.png",
    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "QuestKit",
      logo: {
        alt: "QuestKit logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://questkit.jairukchan.com",
          label: "Demo ↗",
          position: "right",
        },
        {
          href: "https://github.com/ilGentEAcutoO/QuestKit",
          label: "GitHub ↗",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [{ label: "Introduction", to: "/docs/intro" }],
        },
        {
          title: "Project",
          items: [
            { label: "Demo", href: "https://questkit.jairukchan.com" },
            {
              label: "Playground",
              href: "https://play.questkit.jairukchan.com",
            },
            {
              label: "GitHub",
              href: "https://github.com/ilGentEAcutoO/QuestKit",
            },
          ],
        },
      ],
      copyright: `QuestKit · MIT licensed · ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: [
        "bash",
        "json",
        "jsonc",
        "typescript",
        "tsx",
        "jsx",
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
