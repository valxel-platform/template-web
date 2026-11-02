import { expect, test } from "@playwright/test";

test("@smoke the app loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();
});

test("a person can get a greeting", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Greet me" }).click();
  await expect(page.getByRole("status")).toContainText("Ada");
});
