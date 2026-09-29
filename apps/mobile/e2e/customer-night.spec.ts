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
  const find = async (num: string) => (await call("get", `/staff/cards/lookup?set=FDN&num=${num}`, at(7))).card.id;
  const [mythic, common, uncommon] = [await find("101"), await find("7"), await find("55")];
  const contents = [[common, uncommon, mythic], [common, uncommon, common], [uncommon, common, common]];
  for (const [i, pack] of packs.entries()) {
    for (const [slot, card] of contents[i].entries()) {
      await call("put", `/staff/packs/${pack.id}/cards/${slot + 1}`, at(7), { card_id: card, finish: i === 1 && slot === 1 ? "foil" : "nonfoil" });
    }
    await call("post", `/staff/packs/${pack.id}/finalize`, at(8));
  }
  // One video per pack, straight to storage, then approve and notify.
  const bytes = Buffer.alloc(4096, 7);
  for (const pack of packs) {
    await call("post", `/staff/packs/${pack.id}/video/start`, at(9));
    const pathname = `packs/${pack.id}.mp4`;
    const put = await request.put(`${API}/staff/videos/local/${pathname}`, { headers: { authorization: `Bearer ${staff.token}`, "content-type": "video/mp4" }, data: bytes });
    expect(put.ok()).toBeTruthy();
    await call("post", `/staff/packs/${pack.id}/video/finish`, at(9), { pathname, size: bytes.length, sha256: "ab".repeat(32), duration_ms: 60_000, content_type: "video/mp4" });
  }
  expect((await call("post", `/staff/batches/${batch.id}/approve`, at(10))).notified).toBe(1);
}

test("a customer's night: order, get cracked, watch, vault, ship, search", async ({ page, request }) => {
  await page.goto("/sign-in");
  await setNow(page, BEFORE);
  await page.getByTestId("email").fill("alice@e2e.test");
  await page.getByTestId("password").fill("alice password");
  await page.getByTestId("submit").click();

  // Packs is the landing tab: the carousel, the set's limit, tonight's cutoff on server time, the balance.
  await expect(page.getByTestId("cutoff")).toContainText("Order by 7:00 PM PT to be in tonight's rip. 4h 0m");
  await expect(page.getByTestId("balance")).toHaveText("5,000");
  await expect(page.getByTestId("product-FDN")).toContainText("900 credits a pack");
  await expect(page.getByTestId("set-limit")).toHaveText("6 of 6 Foundations packs left for tonight's rip.");
  await shot(page, "m1-packs");

  // Three packs at the 3 pack price. A first order suggests a spending limit, gently.
  await page.getByTestId("qty-3").click();
  await expect(page.getByTestId("buy")).toHaveText(/Buy 3 · 2,550 credits/i);
  await page.getByTestId("buy").click();
  await expect(page.getByTestId("limit-prompt")).toBeVisible();
  await page.getByTestId("limit-not-now").click();
  await expect(page.getByTestId("total")).toHaveText("2,550 credits");
  // First purchase: the 18+ confirmation and the Terms, logged before the order.
  await expect(page.getByTestId("place-order")).toBeDisabled();
  await page.getByTestId("accept-policies").click();
  await shot(page, "m2-order");
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("placed")).toContainText("still sealed");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("balance")).toHaveText("2,450");
  await expect(page.getByTestId("set-limit")).toHaveText("3 of 6 Foundations packs left for tonight's rip.");

  // Account: the credits activity and the order, sealed in tonight's queue.
  await page.getByTestId("tab-account").click();
  await expect(page.getByTestId("account-credits")).toHaveText("2,450 credits");
  await expect(page.getByTestId("activity-row").first()).toContainText("Bought 3 packs Foundations");
  await expect(page.getByTestId("order-queued")).toContainText("sealed, in tonight's queue");
  await shot(page, "m5-account");

  // Tonight happens. The Vault tab gets its dot.
  await runNight(request);
  await setNow(page, "2026-10-01T20:30:00-07:00");
  await page.getByTestId("tab-search").click();
  await expect(page.getByTestId("vault-dot")).toBeVisible();

  // Vault: Cracked today with New marks, then the dot clears.
  await page.getByTestId("tab-vault").click();
  await expect(page.getByTestId("cracked-today")).toContainText("Foundations");
  await expect(page.getByTestId("new-banner")).toBeVisible();
  await expect(page.getByTestId("vault-dot")).toHaveCount(0);
  await expect(page.getByTestId("vault-count")).toContainText("cards. Market prices from Scryfall");
  await expect(page.getByText("Estimated market value")).toHaveCount(0);   // no value headline
  await shot(page, "m3-vault");

  // Cracked today opens a reel, one pack per swipe: the filmed video first.
  await page.locator("[data-testid^=watch-]").first().click();
  await expect(page.getByTestId("reel-count")).toHaveText("1 / 3");
  await expect(page.getByTestId("reel-video").first().locator("video")).toHaveAttribute("src", /\/videos\/local\/packs\/.+\.mp4\?exp=\d+&sig=[0-9a-f]{64}/);
  await shot(page, "m4-reel-video");
  // The quick reveal deals the same logged cards face down, in pulled order.
  await page.getByTestId("mode-reveal").click();
  const reveal = page.getByTestId("reel-reveal").first();
  await expect(reveal.getByTestId("reveal-card-3")).toBeVisible();
  // Tap one card to flip it; hold a face up card to zoom, let go to return.
  await reveal.getByTestId("reveal-touch-1").click();
  await expect(reveal.getByTestId("reveal-touch-1")).toHaveAttribute("aria-label", /Press and hold to zoom/);
  await expect(reveal.getByTestId("reveal-touch-2")).toHaveAttribute("aria-label", /face down/);
  const box = (await reveal.getByTestId("reveal-touch-1").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(reveal.getByTestId("reveal-zoom")).toBeVisible();
  await shot(page, "m4-reel-zoom");
  await page.mouse.up();
  await expect(reveal.getByTestId("reveal-zoom")).toHaveCount(0);
  // Reveal all flips the rest; then Replay deals again.
  await reveal.getByTestId("reveal-all").click();
  await expect(reveal.getByTestId("reveal-replay")).toBeVisible();
  await expect(reveal.getByTestId("reveal-touch-3")).toHaveAttribute("aria-label", /Press and hold to zoom/);
  await shot(page, "m4-reel-reveal");
  // Next pack: a swipe on a phone, the down key on a keyboard.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("reel-count")).toHaveText("2 / 3");
  // The plain list: the Watch page with the video and the cards with prices.
  await page.locator("[data-testid^=reel-cards-]").nth(1).click();
  await expect(page.getByTestId("pack-video").locator("video")).toBeVisible();
  await expect(page.getByTestId("pack-card-3")).toBeVisible();
  await shot(page, "m4-pack");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("reel-close").click();

  // Sell back is off for the test run: keep cards in the vault or ship them.
  // Ship the commons: 5 x $3.50 = $17.50, under $50, so 499 credits shipping.
  await page.getByTestId("select-mode").click();
  await page.getByTestId("holding-FDN-7").click();
  await expect(page.getByTestId("selected-count")).toHaveText("5 selected");
  await expect(page.getByTestId("sell")).toHaveCount(0);
  await page.getByTestId("ship").click();
  // Shipping checkout: the cards, the address, the fee in credits.
  await expect(page.getByTestId("ship-items")).toContainText("Llanowar Elves");
  await expect(page.getByTestId("ship-fee")).toHaveText("499 credits");
  await expect(page.getByTestId("request-shipment")).toBeDisabled();
  await page.getByTestId("addr-name").fill("Alice Example");
  await page.getByTestId("addr-line1").fill("1 K St");
  await page.getByTestId("addr-city").fill("Sacramento");
  await page.getByTestId("addr-state").fill("CA");
  await page.getByTestId("addr-zip").fill("95814");
  await shot(page, "m5-ship-checkout");
  await page.getByTestId("request-shipment").click();
  await expect(page.getByTestId("ship-done")).toContainText("499 credits for shipping.");
  await page.getByTestId("ship-back").click();
  await expect(page.getByTestId("holding-FDN-7")).toHaveCount(0);

  // Search: legality and prices from the catalog.
  await page.getByTestId("tab-search").click();
  await page.getByTestId("search").fill("sheol");
  await expect(page.getByTestId("result-FDN-101")).toBeVisible();
  await shot(page, "m6-search");
  await page.getByTestId("result-FDN-101").click();
  await expect(page.getByTestId("card-name")).toContainText("Sheoldred, the Apocalypse");
  await expect(page.getByTestId("card-legalities")).toContainText("standard");
  await expect(page.getByTestId("card-legalities")).toContainText("commander");
  await shot(page, "m6-card");
});
