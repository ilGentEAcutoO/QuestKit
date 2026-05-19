/**
 * Jest config for @questkit/embed.
 *
 * Mirrors @questkit/react's setup — jsdom env, identity-obj-proxy for CSS
 * imports, ts-jest in CommonJS mode to bypass the ESM/.js suffix dance.
 * Workspace deps are resolved via moduleNameMapper directly to source so
 * tests don't depend on a prior `pnpm build`.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@questkit/types$": "<rootDir>/../types/src/index.ts",
    "^@questkit/core$": "<rootDir>/../core/src/index.ts",
    "^@questkit/react$": "<rootDir>/../react/src/index.ts",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          jsx: "react-jsx",
          verbatimModuleSyntax: false,
        },
      },
    ],
  },
  testMatch: ["<rootDir>/test/**/*.test.{ts,tsx}"],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/index.ts", "!src/**/*.d.ts"],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov"],
  coverageThreshold: {
    global: {
      lines: 60,
      statements: 60,
      functions: 60,
      branches: 50,
    },
  },
  clearMocks: true,
};
