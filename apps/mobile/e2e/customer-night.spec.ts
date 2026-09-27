import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://localhost:8789";
const BEFORE = "2026-10-01T15:00:00-07:00";
const AFTER = "2026-10-01T19:05:00-07:00";
const at = (min: number) => `2026-10-01T19:${String(10 + min).padStart(2, "0")}:00-07:00`;

async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png` });
}
const setNow = (page: Page, iso: string) => page.evaluate((t) => localStorage.setItem("crackapack.testNow", t), iso);

/** Runs tonight's session the way staff would, through the staff API. */
async function runNight(request: APIRequestContext) {
  const staff = await (await request.post(`${API}/dev/login`, { data: { email: "ops@e2e.test", role: "staff" } })).json();
  const call = async (method: "get" | "post" | "put", path: string, when: string, data?: unknown) => {
    const r = await request[method](`${API}${path}`, { headers: { authorization: `Bearer ${staff.token}`, "x-test-now": when }, data });
    expect(r.ok(), `${method} ${path}: ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  const { batch } = await call("get", "/staff/tonight", AFTER);
  await call("post", `/staff/batches/${batch.id}/lock`, AFTER);
  const { session_id } = await call("post", `/staff/batches/${batch.id}/sessions`, at(0), { stream_ref: "https://stream.e2e/night.mp4" });
  const state = await call("get", `/staff/sessions/${session_id}`, at(0));
  await call("post", `/staff/sessions/${session_id}/boxes/${state.next.sealed_boxes[0].id}/open`, at(1));
  for (let i = 0; i < 3; i++) await call("post", `/staff/sessions/${session_id}/next`, at(2 + i));
  await call("post", `/staff/sessions/${session_id}/complete`, at(6));
  const { packs } = await call("get", `/staff/batches/${batch.id}/packs`, at(7));
  const find = async (num: string) => (await call("get", `/staff/cards?set=FDN&num=${num}`, at(7))).cards[0].id;
  const [mythic, common, uncommon] = [await find("101"), await find("7"), await find("55")];
  const contents = [[common, uncommon, mythic], [common, uncommon, common], [uncommon, common, common]];
  for (const [i, pack] of packs.entries()) {
    for (const [slot, card] of contents[i].entries()) {
      await call("put", `/staff/packs/${pack.id}/cards/${slot + 1}`, at(7), { card_id: card, finish: i === 1 && slot === 1 ? "foil" : "nonfoil" });
    }
    await call("post", `/staff/packs/${pack.id}/finalize`, at(8));
  }
  expect((await call("post", `/staff/batches/${batch.id}/notify`, at(9))).notified).toBe(1);
}

test("a customer's night: order, get cracked, reveal, vault, sell back, search", async ({ page, request }) => {
  await page.goto("/");
  await setNow(page, BEFORE);
  await page.getByTestId("email").fill("alice@e2e.test");
  await page.getByTestId("sign-in").click();

  // Packs is the landing tab: tonight's cutoff, the balance, the set on sale.
  await expect(page.getByTestId("cutoff")).toContainText("Tonight's queue locks in 4h 0m");
  await expect(page.getByTestId("balance")).toHaveText("5,000");
  await expect(page.getByTestId("product-FDN")).toContainText("900 credits");
  await shot(page, "m1-packs");

  // Order 3 packs: the ladder prices them at $8.50 each. Ordering queues, it doesn't rip.
  await page.getByTestId("product-FDN").click();
  await page.getByTestId("qty-3").click();
  await expect(page.getByTestId("total")).toHaveText("2,550 credits");
  await shot(page, "m2-order");
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("placed")).toContainText("still sealed");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("balance")).toHaveText("2,450");

  // Account shows it sealed in tonight's queue.
  await page.getByTestId("tab-account").click();
  await expect(page.getByTestId("order-queued")).toContainText("sealed, in tonight's queue");

  // Tonight happens.
  await runNight(request);
  await setNow(page, "2026-10-01T20:30:00-07:00");

  // The notification opens the reveal: tap to crack, cards one at a time, the mythic last.
  await page.goto("/account");
  await page.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByTestId("tap-to-crack")).toBeVisible();
  await page.getByTestId("reveal").click();                     // crack pack 1
  await expect(page.getByTestId("revealed-name")).toBeVisible();
  await expect(page.getByTestId("big-hit")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("revealed-name")).toHaveText("Sheoldred, the Apocalypse");
  await shot(page, "m3-reveal-hit");
  await page.getByTestId("skip").click();
  await expect(page.getByTestId("reveal-done")).toContainText("You cracked 3 packs");
  await shot(page, "m4-reveal-done");
  await page.getByTestId("to-vault").click();

  // Vault: today's pulls on top, the mythic held individually, live value.
  await expect(page.getByTestId("todays-pulls")).toContainText("Today's pulls · 2026-10-01");
  await expect(page.getByTestId("holding-FDN-101")).toContainText("held individually");
  await expect(page.getByTestId("vault-value")).toHaveText("$63.90");
  await shot(page, "m5-vault");

  // Sell the commons back: 5 x $3.50 at 90% = 1,575 credits, earned (non withdrawable).
  await page.getByTestId("holding-FDN-7").click();
  await page.getByTestId("sell").click();
  await expect(page.getByTestId("quote")).toHaveText("1,575 credits");
  await page.getByTestId("confirm-sell").click();
  await expect(page.getByTestId("sold")).toContainText("1,575 credits added");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("holding-FDN-7")).toHaveCount(0);

  // Search: legality and prices from the catalog.
  await page.getByTestId("tab-search").click();
  await page.getByTestId("search").fill("sheol");
  await page.getByTestId("result-FDN-101").click();
  await expect(page.getByTestId("card-name")).toContainText("Sheoldred, the Apocalypse");
  await expect(page.getByTestId("card-legalities")).toContainText("standard");
  await expect(page.getByTestId("card-legalities")).toContainText("commander");
  await shot(page, "m6-card");
});
