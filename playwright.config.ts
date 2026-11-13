import { defineConfig, devices } from "@playwright/test";

// End-to-end and smoke tests run against a deployed environment (BASE_URL), triggered by the
// Valxel SDLC after a deployment is ready (see .github/workflows/post-deploy.yml).
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["junit", { outputFile: "reports/e2e-junit.xml" }], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
