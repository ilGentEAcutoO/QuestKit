// @ts-check
import antfu from "@antfu/eslint-config";

/**
 * Flat ESLint config for QuestKit.
 *
 * @antfu/eslint-config bundles TypeScript, React, Vue, JSON, YAML, and Markdown
 * rules in one zero-config preset. We let Prettier own raw whitespace
 * (`stylistic: false`) but keep antfu's formatter integration for JSON / Markdown
 * / YAML where Prettier isn't wired in.
 */
export default antfu({
  type: "lib",
  typescript: true,
  // react/jsx re-enabled in TASK-014 when packages/react lands.
  // @antfu/eslint-config 3.16 + @eslint-react/eslint-plugin 5.x have a
  // ConfigError on the react preset's `react-dom` plugin key; revisit
  // peer-dep pinning then.
  react: false,
  jsx: false,
  formatters: true,
  stylistic: false,
  ignores: [
    "dist/**",
    "build/**",
    "**/node_modules/**",
    "apps/docs/build/**",
    "**/.wrangler/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/worker-configuration.d.ts",
    "pnpm-lock.yaml",
  ],
});
