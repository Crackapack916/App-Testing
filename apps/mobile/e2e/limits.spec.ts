import { expect, test } from "@playwright/test";

// Item 4: limits are optional, editable any time (except loosening during a break), shown in plain words.
test("set, lower, remove limits, then a break that blocks ordering and can only be ended by request", async ({ page }) => {
  await page.goto("/sign-in");
  // A different night from the other specs, so queues never mix.
  await page.evaluate(() => localStorage.setItem("crackapack.testNow", "2026-10-05T15:00:00-07:00")); // Monday
  await page.getByTestId("email").fill("limits@e2e.test");
  await page.getByTestId("password").fill("limits password");
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/\/packs$/);

  await page.getByTestId("tab-account").click();
  for (const p of ["daily", "weekly", "monthly"]) await expect(page.getByTestId(`limit-${p}-value`)).toHaveText("No limit");

  // Weekly limit of 1,000 credits.
  await page.getByTestId("limit-weekly-edit").click();
  await page.getByTestId("limit-weekly-input").fill("1000");
  await page.getByTestId("limit-weekly-save").click();
  await expect(page.getByTestId("limit-weekly-progress")).toHaveText("0 of 1,000 credits used this week. Resets Monday 12:00 AM Pacific.");

  // One pack (900) fits; a second doesn't.
  await page.getByTestId("tab-packs").click();
  await page.getByTestId("product-FDN").click();
  await page.getByTestId("qty-1").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("placed")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByTestId("product-FDN").click();
  await page.getByTestId("qty-1").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByText("That order would pass your weekly spending limit.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Raise, then remove: both take effect at once (no delay configured for the test run).
  await page.getByTestId("tab-account").click();
  await expect(page.getByTestId("limit-weekly-progress")).toHaveText("900 of 1,000 credits used this week. Resets Monday 12:00 AM Pacific.");
  await page.getByTestId("limit-weekly-edit").click();
  await page.getByTestId("limit-weekly-input").fill("3000");
  await page.getByTestId("limit-weekly-save").click();
  await expect(page.getByTestId("limit-weekly-value")).toHaveText("3,000 credits");
  await page.getByTestId("limit-weekly-remove").click();
  await expect(page.getByTestId("limit-weekly-value")).toHaveText("No limit");

  // A 24 hour break: no ordering, and only an early end request.
  await page.getByTestId("break-24").click();
  await page.getByTestId("start-break").click();
  await expect(page.getByTestId("on-break")).toContainText("You're on a break until");
  await expect(page.getByTestId("limit-weekly-remove")).toHaveCount(0);
  await page.getByTestId("request-end").click();
  await expect(page.getByTestId("end-requested")).toContainText("crackapack.business@gmail.com");
  await page.getByTestId("tab-packs").click();
  await page.getByTestId("product-FDN").click();
  await page.getByTestId("qty-1").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByText("You're on a break. You can't buy packs or add credit until it ends.")).toBeVisible();
});
