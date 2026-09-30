import { expect, test, type Page } from "@playwright/test";
import { auditContrast, formatIssues, type ContrastIssue } from "./contrast";

const API = "http://localhost:8789";

/**
 * WCAG AA contrast on every page, signed out and signed in, on a phone and at desktop width
 * (where the top bar replaces the tab bar), including error and empty states.
 * The customer's night in customer-night.spec.ts audits the vault, reel, reveal, Watch and ship pages.
 */
const signedOut = ["/packs", "/drops", "/search", "/sign-in", "/reset-password", "/policies", "/policies/terms", "/policies/privacy", "/policies/fairness"];
const signedIn = ["/packs", "/drops", "/search", "/vault", "/account", "/add-credits", "/verify-age", "/policies"];

async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

for (const [label, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]] as const) {
  test(`contrast: every page passes WCAG AA (${label})`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const issues: ContrastIssue[] = [];
    const audit = async (name: string) => issues.push(...await auditContrast(page, `${label} ${name}`));

    for (const path of signedOut) { await settle(page, path); await audit(path); }

    // Error states: a refused sign in and a search with no results.
    await settle(page, "/sign-in");
    await page.getByTestId("email").fill("nobody@e2e.test");
    await page.getByTestId("password").fill("wrong password");
    await page.getByTestId("submit").click();
    await page.waitForTimeout(600);
    await audit("sign-in error");

    // A new customer, signed up through the API, with an empty vault.
    const email = `contrast-${label}@e2e.test`;
    const r = await request.post(`${API}/auth/signup`, { data: { email, password: "contrast password", dob: { month: "06", day: "15", year: "1990" }, accept_terms: true } });
    expect(r.ok(), await r.text()).toBeTruthy();
    const { token } = await r.json();
    await page.evaluate((t) => localStorage.setItem("crackapack.customer.token", t), token);
    for (const path of signedIn) { await settle(page, path); await audit(path); }

    await settle(page, "/search");
    await page.getByTestId("search").fill("zzzz no such card");
    await page.waitForTimeout(800);
    await audit("search empty");

    const photos = issues.filter((i) => i.kind === "over image");
    if (photos.length) console.log(`Text over images, check by eye:\n${formatIssues(photos)}`);
    const fails = issues.filter((i) => i.kind !== "over image");
    expect(fails, formatIssues(fails)).toEqual([]);
  });
}
