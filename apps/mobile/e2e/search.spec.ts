import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

// Item 8: guests search our own database; typing never calls Scryfall.
test("a guest searches by name with a debounce, opens a printing by set and number, and filters", async ({ page }) => {
  const scryfallApi: string[] = [];
  const searches: string[] = [];
  await page.route(/api\.scryfall\.com/, (r) => { scryfallApi.push(r.request().url()); return r.abort(); });
  await page.route(/cards\.scryfall\.io/, (r) => r.abort()); // images: offline in tests
  page.on("request", (r) => { if (r.url().includes("/cards/search")) searches.push(r.url()); });

  await page.goto("/search");
  await expect(page).toHaveURL(/\/search$/);                       // no sign in wall
  await page.getByTestId("search").pressSequentially("lightning bolt", { delay: 40 });
  await expect(page.getByTestId("result-CLU-141")).toBeVisible();
  // One request after typing stops, not one per keystroke.
  expect(searches.length).toBeLessThanOrEqual(2);
  expect(scryfallApi).toEqual([]);
  await expect(page.getByTestId("result-CLU-141")).toContainText("$2.02");
  // A foil only printing shows its foil price.
  await expect(page.getByTestId("result-PF25-13")).toContainText("$5.20 foil");

  // "set number" opens the exact printing.
  await page.getByTestId("search").fill("sld 1638★");
  await expect(page.getByTestId("card-name")).toContainText("Lightning Bolt");
  await expect(page.getByTestId("card-prices")).toContainText("foil: $4.32 as of");
  await expect(page.getByTestId("card-legalities")).toContainText("modern");
  await page.getByRole("button", { name: "Close" }).click();

  // Filters and sort.
  await page.getByTestId("search").fill("lightning bolt");
  await page.getByTestId("toggle-filters").click();
  await page.getByTestId("filter-set").fill("m10");
  await expect(page.locator('[data-testid^="result-"]')).toHaveCount(1);
  await page.getByTestId("filter-set").fill("");
  // Two real Bolt printings come in etched foil.
  await page.getByTestId("filter-finish-etched").click();
  await expect(page.locator('[data-testid^="result-"]')).toHaveCount(2);
  await page.getByTestId("filter-finish-etched").click();
  // A name that doesn't exist finds nothing.
  await page.getByTestId("search").fill("zzqx nothing");
  await expect(page.getByText("No cards found.")).toBeVisible();
  await page.getByTestId("search").fill("lightning bolt");
  await page.getByTestId("sort-price").click();
  await expect(page.locator('[data-testid^="result-"]').first()).toBeVisible();
  expect(scryfallApi).toEqual([]);
});
