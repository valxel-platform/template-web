import { expect, test } from "@playwright/test";

// The deployed app, as served through the product's BFF (BASE_URL). Signing in needs a test
// identity, so journeys across the API live in the product's acceptance tests; here the session
// and the API are stubbed to check this app's own pages.

test("@smoke the app loads and offers to sign in", async ({ page }) => {
  await page.route("**/auth/me", (route) => route.fulfill({ json: { authenticated: false } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a signed-in person can get a greeting", async ({ page }) => {
  await page.route("**/auth/me", (route) =>
    route.fulfill({ json: { authenticated: true, sub: "u1", name: "Ada" } }),
  );
  await page.route("**/api/v1/greetings?*", (route) => route.fulfill({ json: { message: "Hello, Ada!" } }));
  await page.goto("/");
  await expect(page.getByText("Signed in as Ada")).toBeVisible();
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Greet me" }).click();
  await expect(page.getByRole("status")).toContainText("Ada");
});

test("every page carries the security headers", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["strict-transport-security"]).toContain("max-age=");
});
