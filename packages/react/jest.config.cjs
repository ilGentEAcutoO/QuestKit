
/**
 * Jest config for @questkit/react.
 *
 * Mirrors `@questkit/core`'s ts-jest non-ESM strategy (CommonJS preset to
 * avoid Jest's ESM/.js-suffix dance in monorepos). Differences for React:
 *
 *   - testEnvironment: jsdom (the default for component / hook tests)
 *   - jsx: "react-jsx" override so ts-jest emits the new JSX transform
 *   - identity-obj-proxy maps `*.module.css` imports to themselves so
 *     tests that touch a styled component don't crash on the CSS import
 *   - setupFilesAfterEach pulls in @testing-library/jest-dom matchers
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@questkit/types$": "<rootDir>/../types/src/index.ts",
    "^@questkit/core$": "<rootDir>/../core/src/index.ts",
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
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/index.ts",
    "!src/**/*.d.ts",
  ],
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
