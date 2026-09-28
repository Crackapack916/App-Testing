import { expect, test } from "@playwright/test";

// Item 1: sign up on a small phone without leaving the page or scrolling.
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test("sign up at 375 by 667: three date fields, auto advance, 18+ checked on the server, no scrolling", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("crackapack.testNow", "2026-10-03T15:00:00-07:00"));
  await page.getByTestId("to-signup").click();

  // The whole form fits: nothing scrolls, nothing sits off the right edge.
  const fits = async () => page.evaluate(() => ({
    v: document.scrollingElement!.scrollHeight <= innerHeight, h: document.documentElement.scrollWidth <= innerWidth,
    off: [...document.querySelectorAll("input, button, [role=button], [role=checkbox]")].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1);
    }).length }));
  expect(await fits()).toEqual({ v: true, h: true, off: 0 });

  // Numeric fields with birthday autofill hints and max lengths.
  for (const [id, ac, max] of [["dob-mm", "bday-month", 2], ["dob-dd", "bday-day", 2], ["dob-yyyy", "bday-year", 4]] as const) {
    const attrs = await page.getByTestId(id).evaluate((e: HTMLInputElement) => ({ im: e.inputMode, ac: e.autocomplete, max: e.maxLength }));
    expect(attrs).toEqual({ im: "numeric", ac, max });
  }

  await page.getByTestId("email").fill("newbie@e2e.test");
  await page.getByTestId("password").fill("a good password");
  // Typing a full month moves focus to Day, and a full day moves to Year.
  await page.getByTestId("dob-mm").pressSequentially("06");
  await expect(page.getByTestId("dob-dd")).toBeFocused();
  await page.getByTestId("dob-dd").pressSequentially("15");
  await expect(page.getByTestId("dob-yyyy")).toBeFocused();
  await page.getByTestId("dob-yyyy").pressSequentially("2010");
  await page.getByTestId("agree").click();
  expect(await fits()).toEqual({ v: true, h: true, off: 0 });

  // Under 18: refused by the server with the brief's wording.
  await page.getByTestId("submit").click();
  await expect(page.getByText("You must be 18 or older to use CrackAPack.")).toBeVisible();
  expect(await fits()).toEqual({ v: true, h: true, off: 0 });

  // A real 18+ date signs straight in.
  await page.getByTestId("dob-yyyy").fill("1994");
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/\/packs$/);
});

test("log in with email and password, and a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("email").fill("alice@e2e.test");
  await page.getByTestId("password").fill("wrong password");
  await page.getByTestId("submit").click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await page.getByTestId("password").fill("alice password");
  await page.getByTestId("submit").click();
  await expect(page).toHaveURL(/\/packs$/);
});
