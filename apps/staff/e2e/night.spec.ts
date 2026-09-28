import { expect, test, type Page } from "@playwright/test";

/** Set SCREENSHOTS=<dir> to save the key screens while the test runs. */
async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png` });
}

/** Pins the server clock (test mode only) for every request the tool makes. */
async function setTime(page: Page, iso: string) {
  await page.evaluate((t) => localStorage.setItem("crackapack.testNow", t), iso);
}

test("a full night: lock, film in strict order, log cards, notify", async ({ page }) => {
  await page.goto("/ops/");
  await setTime(page, "2026-10-01T19:02:00-07:00");
  await page.getByLabel("Email").fill("ops@e2e.test");
  await page.getByLabel("Password").fill("ops password");
  await page.getByRole("button", { name: "Log in" }).click();

  // Tonight: provisional queue, then lock.
  const queue = page.getByTestId("queue");
  await expect(queue.locator("tbody tr")).toHaveCount(3);
  await expect(queue.locator("tbody tr td:nth-child(2)")).toHaveText(["alice", "alice", "bob"]);
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("manifest")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(queue.locator("tbody tr td:first-child")).toHaveText(["1", "2", "3"]);
  await shot(page, "1-tonight-locked");

  // Start the filmed session.
  await setTime(page, "2026-10-01T19:10:00-07:00");
  await page.getByLabel("Stream or recording URL").fill("https://stream.e2e/night.m3u8");
  await page.getByTestId("start").click();

  // Session: B opens the box on camera, Space cracks the next pack in queue order.
  const next = page.getByTestId("next");
  await expect(next).toContainText("#1");
  await expect(next).toContainText("alice");
  await setTime(page, "2026-10-01T19:11:00-07:00");
  await page.keyboard.press("b");
  await expect(page.getByTestId("open-pack")).toBeVisible();
  await shot(page, "2-session");
  for (const [i, who] of [["2", "alice"], ["3", "bob"]] as const) {
    await setTime(page, `2026-10-01T19:1${Number(i) + 1}:00-07:00`);
    await page.keyboard.press("Space");
    await expect(next).toContainText(`#${i}`);
    await expect(next).toContainText(who);
  }
  await setTime(page, "2026-10-01T19:15:00-07:00");
  await page.keyboard.press("Space");
  await expect(page.getByText("Queue complete")).toBeVisible();
  await page.getByTestId("complete").click();

  // Log cards from the locked queue: number, then finish, then Enter. Keyboard only.
  await page.keyboard.press("l");
  const collector = page.getByTestId("collector");
  await collector.fill("999");
  await expect(page.getByText("No FDN #999.")).toBeVisible();
  for (let pack = 0; pack < 3; pack++) {
    for (const [num, foil] of [["101", false], ["7", false], ["55", true]] as const) {
      await collector.fill(num);
      await expect(page.getByTestId("preview")).toContainText(`FDN #${num}`);   // resolved: image, name, price
      if (foil) {
        await collector.press("Tab");                                          // into the finish group
        await page.keyboard.press("ArrowRight");                               // nonfoil to foil
        await expect(page.getByTestId("finish-foil")).toBeChecked();
        await page.keyboard.press("Enter");
      } else {
        await collector.press("Enter");
      }
      await expect(collector).toHaveValue("");
      await expect(collector).toBeFocused();
    }
    if (pack === 0) {
      await page.getByTestId("add-token").click();
      await expect(page.getByTestId("count")).toHaveText("3 cards + 1 other");
    }
    await expect(page.getByTestId("contents")).toContainText("foil");
    if (pack === 0) await shot(page, "3-log-cards");
    await collector.press("Control+Enter");
  }
  await expect(page.getByText("All opened packs are logged.")).toBeVisible();

  // A change after approval needs a reason and is kept in the history.
  await page.getByTestId("packs").locator("li").first().click();
  await expect(page.getByTestId("approved-banner")).toBeVisible();
  await page.getByTestId("amend-2").click();
  await page.getByTestId("amend-reason").fill("Video shows a foil");
  await collector.fill("7");
  await expect(page.getByTestId("preview")).toContainText("FDN #7");
  await page.getByTestId("finish-foil").check();
  await page.getByTestId("add").click();
  await expect(page.getByTestId("contents").locator("tbody tr").nth(1)).toContainText("foil");
  await page.getByTestId("history").locator("summary").click();
  await expect(page.getByTestId("history")).toContainText("amended slot 2");
  await expect(page.getByTestId("history")).toContainText("Video shows a foil");

  // Notify: both orders are ready.
  await page.keyboard.press("n");
  await expect(page.getByTestId("ready")).toHaveText("2");
  await shot(page, "4-notify");
  await page.getByTestId("notify").click();
  await expect(page.getByTestId("ready")).toHaveText("0");
  await expect(page.getByTestId("orders").locator("tbody tr td:last-child")).toHaveText(["notified", "notified"]);
});

test("put a set on sale: create, receive a box, turn it on", async ({ page }) => {
  await page.goto("/ops/");
  await setTime(page, "2026-10-02T09:00:00-07:00");
  await page.getByLabel("Email").fill("ops@e2e.test");
  await page.getByLabel("Password").fill("ops password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: /Stock/ })).toBeVisible();
  await page.keyboard.press("k");
  await page.getByTestId("set-search").fill("Edge");
  await page.getByTestId("set-EOE").click();
  const card = page.getByTestId("product-EOE");
  await expect(card).toContainText("Off sale");
  await card.getByTestId("box-label").fill("EOE-0001");
  await card.getByTestId("receive").click();
  await expect(card.getByTestId("sellable")).toHaveText("29");
  await card.getByTestId("toggle").click();
  await expect(card).toContainText("On sale");
  await shot(page, "5-stock");
});

test("ship a customer's cards: pick list, tracking, mark shipped", async ({ page, request }) => {
  // Alice (from the night above) asks to ship her commons.
  const api = "http://localhost:8788";
  const alice = await (await request.post(`${api}/dev/login`, { data: { email: "alice@e2e.test" } })).json();
  const auth = { authorization: `Bearer ${alice.token}`, "x-test-now": "2026-10-01T21:00:00-07:00" };
  const vault = await (await request.get(`${api}/me/vault`, { headers: auth })).json();
  const common = vault.cards.find((c: any) => c.collector_number === "7");
  const r = await request.post(`${api}/me/shipments`, { headers: auth, data: {
    items: [{ card_id: common.card_id, finish: common.finish, condition: common.condition, qty: common.qty }],
    address: { name: "Alice Doe", line1: "1 Capitol Mall", city: "Sacramento", state: "CA", zip: "95814" } } });
  expect(r.status()).toBe(201);

  await page.goto("/ops/");
  await setTime(page, "2026-10-02T09:00:00-07:00");
  await page.getByLabel("Email").fill("ops@e2e.test");
  await page.getByLabel("Password").fill("ops password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: /Ship/ })).toBeVisible();
  await page.keyboard.press("p");
  const card = page.locator("[data-testid^=shipment-]");
  await expect(card).toContainText("alice");
  await expect(card).toContainText("Alice Doe");
  await expect(card).toContainText("Card 7");
  await shot(page, "6-ship");
  await card.getByTestId("tracking").fill("9400111202555842761234");
  await card.getByTestId("mark-shipped").click();
  await expect(page.getByText("No shipments waiting.")).toBeVisible();
});
