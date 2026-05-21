/**
 * Jest config for @questkit/demo.
 *
 * Mirrors the @questkit/react setup so the demo app picks up the same
 * ts-jest + jsdom + jest-dom matchers + identity-obj-proxy CSS shim.
 *
 * The demo's primary test framework is Playwright (./e2e/), but a few
 * pure-render unit tests live here too — e.g. Layout.test.tsx asserts the
 * footer reads its version from the monorepo root package.json (TASK-004 /
 * D5).
 *
 * Module-name mapping:
 *   - @questkit/types and @questkit/react point at their workspace `src/`
 *     so we don't have to rebuild the packages before running unit tests.
 *   - JSON imports (e.g. `import pkg from "../../../../package.json"`) are
 *     handled natively by ts-jest.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@questkit/types$": "<rootDir>/../../packages/types/src/index.ts",
    "^@questkit/core$": "<rootDir>/../../packages/core/src/index.ts",
    "^@questkit/react$": "<rootDir>/../../packages/react/src/index.ts",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          jsx: "react-jsx",
          esModuleInterop: true,
          resolveJsonModule: true,
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  clearMocks: true,
};
