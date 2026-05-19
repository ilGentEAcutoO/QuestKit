 
/**
 * Jest config for @questkit/core (CommonJS to avoid the ts-node hard-dep that
 * Jest 29 imposes on .ts config files).
 *
 * Decision: we use the *non-ESM* ts-jest preset. The brief flagged that
 * ts-jest's ESM preset can be awkward in monorepos (extensionsToTreatAsEsm
 * + .js suffix in test imports + Node flags). The non-ESM path lets us
 * write test imports like `import { x } from "../src/y"` without any
 * `.js` suffix dance. Runtime cost is zero because we ship the built bundle
 * (dist/index.{js,cjs}) — consumers get ESM/CJS via tsdown.
 *
 * tsconfig.base.json has `verbatimModuleSyntax: true`, which forbids CJS
 * emit. We override `module: CommonJS` + `verbatimModuleSyntax: false` ONLY
 * for ts-jest so the runner can transpile to CJS; production typecheck still
 * enforces the strict flag via `pnpm typecheck`.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  // Default to Node — it has fetch, Response, Request, Headers,
  // ReadableStream, TextEncoder, TextDecoder as built-in globals (Node 18+).
  // Tests that need window.localStorage opt-in with `@jest-environment jsdom`
  // doc-block pragma (currently only storage.test.ts).
  testEnvironment: "node",
  moduleNameMapper: {
    "^@questkit/types$": "<rootDir>/../types/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          verbatimModuleSyntax: false,
          // Inherit other strict flags from the project tsconfig — these
          // override that subset only for ts-jest's compile.
        },
      },
    ],
  },
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov"],
  coverageThreshold: {
    global: {
      lines: 70,
      statements: 70,
      functions: 70,
      branches: 60,
    },
  },
  clearMocks: true,
};
