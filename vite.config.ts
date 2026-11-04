import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local development: the API runs on 8080 (see the service template).
    // Feature flags: a local Flipt on 8081 (see README); without one, flags are off.
    proxy: { "/api": "http://localhost:8080", "/ofrep": "http://localhost:8081" },
  },
  build: { sourcemap: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.pact.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          // Consumer contract tests: they write pacts/*.json for the provider to verify.
          name: "contract",
          environment: "node",
          globals: true,
          include: ["src/**/*.pact.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
    reporters: ["default", "junit"],
    outputFile: { junit: "reports/junit.xml" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/test-setup.ts", "src/vite-env.d.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // The platform's floor; products may raise it (see <product>-governance/product.yaml quality.unit).
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
