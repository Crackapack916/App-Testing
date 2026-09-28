import { expect, test } from "@playwright/test";

// Item 18: public, plain, dated pages, reachable from the footer.
test("a guest reads the fairness promise and the Terms from the footer", async ({ page }) => {
  await page.goto("/search");
  await page.getByTestId("footer").getByText("Fairness and policies").click();
  await expect(page).toHaveURL(/\/policies$/);
  const fair = page.getByTestId("policy-fairness");
  await expect(fair).toContainText("How your pack is handled");
  await expect(fair).toContainText("Nobody picks which pack goes to which order.");
  await expect(fair).not.toContainText("Selling cards back");    // sell back is off for the test run
  await expect(page.getByText(/^Last updated September 2\d, 2026$/).first()).toBeVisible();
  await page.getByTestId("read-terms").click();
  await expect(page.getByTestId("policy-terms")).toContainText("TODO for counsel");
  await expect(page.getByTestId("policy-terms")).toContainText("Governing law");
});
