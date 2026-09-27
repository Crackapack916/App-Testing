import { expect, test } from "@playwright/test";

test("a new customer verifies their age, and their spending limit is enforced", async ({ page }) => {
  await page.goto("/");
  // A different night from customer-night.spec, so the two tests never share a queue.
  await page.evaluate(() => localStorage.setItem("crackapack.testNow", "2026-10-03T15:00:00-07:00"));
  await page.getByTestId("email").fill("bob@e2e.test");
  await page.getByTestId("sign-in").click();

  // Age gate before anything else.
  await page.getByTestId("dob-mm").fill("06");
  await page.getByTestId("dob-dd").fill("15");
  await page.getByTestId("dob-yyyy").fill("2010");
  await page.getByTestId("state").fill("ca");
  await page.getByTestId("verify").click();
  await expect(page.getByText("You must be 18 or older to order.")).toBeVisible();
  await page.getByTestId("dob-yyyy").fill("1994");
  await page.getByTestId("verify").click();
  await expect(page.getByTestId("balance")).toHaveText("5,000");

  // Lower the 24 hour limit to $25, then try a $25.50 order.
  await page.getByTestId("tab-account").click();
  await page.getByTestId("limit-2500").click();
  await expect(page.getByText("$0.00 of $25.00")).toBeVisible();
  await page.getByTestId("tab-packs").click();
  await page.getByTestId("product-FDN").click();
  await page.getByTestId("qty-3").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByText("That order would pass your 24 hour spending limit.")).toBeVisible();
  // One pack fits.
  await page.getByTestId("qty-1").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("placed")).toBeVisible();
});
