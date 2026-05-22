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
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  // F13 / v0.1.21: DISABLED `future.faster.swcJsLoader: true`. The flag was
  // added in TASK-026c to bypass a webpack-CJS parser bug, but it ALSO
  // strips CSS module class names from the SSR HTML — `.docMainContainer_*`
  // / `.docRoot_*` (the hashed CSS module classes that own Docusaurus's
  // sidebar + content flex layout) never landed on the DOM divs, so the
  // sidebar (aside) and main wrapper both rendered as 1905px display:block
  // siblings instead of flex children. v0.1.17 → v0.1.20 chased CSS-side
  // symptoms (Prism, important, preflight, theme.css transitive) but the
  // actual issue was JS-side: the swc loader wasn't running the CSS
  // module name-transformation step that webpack's css-loader normally
  // does. Reverting to the default JS loader brings CSS modules back.
  //
  // If the original webpack-CJS parser bug (TASK-026c) returns, address it
  // with a more targeted fix (e.g. configurePostCss + webpack alias) rather
  // than swc-loader, which has broader compat issues.

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
      // NOTE (F9-a / v0.1.17): "jsonc" was in this list but Prism doesn't
      // ship a `prism-jsonc` language module — Docusaurus tried to load it
      // at runtime, the dynamic require threw, the whole JS bundle crashed,
      // and the docs site rendered as raw unstyled markup (no CSS, no
      // hydration). Removed jsonc; ```jsonc code blocks degrade to plain
      // text. If/when JSONC highlighting is needed, add a custom Prism
      // plugin that aliases jsonc to json + a comment grammar — don't
      // add jsonc back to this list without verifying the module exists.
      additionalLanguages: ["bash", "json", "typescript", "tsx", "jsx"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
