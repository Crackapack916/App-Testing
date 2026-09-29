import { expect, test, type Page } from "@playwright/test";

/** Set SCREENSHOTS=<dir> to save the key screens while the test runs. */
async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/${name}.png` });
}

/** Pins the server clock (test mode only) for every request the tool makes. */
async function setTime(page: Page, iso: string) {
  await page.evaluate((t) => localStorage.setItem("crackapack.testNow", t), iso);
}

test("a full night: lock, film in strict order, log cards, upload videos, approve", async ({ page }) => {
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

  // Open packs: nothing to start. Each pack is recorded on a phone and uploaded later.
  await setTime(page, "2026-10-01T19:10:00-07:00");
  await page.getByTestId("start").click();

  // B opens the box, Space cracks the next pack in queue order.
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
  // The last pack finishes the night's opening by itself.
  await expect(page.getByTestId("opening-done")).toContainText("All packs opened");

  // Log cards from the locked queue: number, then finish, then Enter. Keyboard only.
  await page.keyboard.press("l");
  const collector = page.getByTestId("collector");
  await collector.fill("999");
  await expect(page.getByText("No FDN #999.")).toBeVisible();
  // Esc leaves the box, so a screen key switches screens instead of typing into it.
  await collector.press("Escape");
  await page.keyboard.press("t");
  await expect(page.getByRole("heading", { name: "Sealed stock" })).toBeVisible();
  await page.keyboard.press("l");
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

  // Videos: one file per pack from the queue view, then approve and notify.
  await page.keyboard.press("n");
  await expect(page.getByTestId("videos-ready")).toHaveText("0 / 3");
  await expect(page.getByTestId("approve")).toBeDisabled();
  // A file this browser can't play (like HEVC) is refused with a clear warning.
  await page.getByTestId("upload-1").setInputFiles({ name: "IMG_0001.mov", mimeType: "video/quicktime", buffer: Buffer.from("not really a video") });
  await expect(page.getByTestId("upload-error-1")).toContainText("Most Compatible");
  const video = await recordVideo(page);
  for (const pos of [1, 2, 3]) {
    await page.getByTestId(`upload-${pos}`).setInputFiles({ name: `pack-${pos}.mp4`, mimeType: "video/mp4", buffer: video });
    await expect(page.getByTestId(`video-status-${pos}`)).toHaveText("ready", { timeout: 20_000 });
  }
  await expect(page.getByTestId("videos-ready")).toHaveText("3 / 3");
  await page.getByTestId("preview-2").click();
  const player = page.getByTestId("preview-player");
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);   // decodes: playable, scrubbable
  await shot(page, "4-videos");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("notified")).toHaveText("Notified 2 orders.");
  await expect(page.getByTestId("video-status-1")).toHaveText("approved");
});

/** A short real mp4, recorded in the browser from a canvas (Chromium writes VP9 in mp4). */
async function recordVideo(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 180;
    const g = c.getContext("2d")!;
    const rec = new MediaRecorder(c.captureStream(24), { mimeType: "video/mp4" });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < 30; i++) { g.fillStyle = `hsl(${i * 12}, 40%, 40%)`; g.fillRect(0, 0, 320, 180); await new Promise((r) => setTimeout(r, 40)); }
    rec.stop();
    await stopped;
    const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
    let s = ""; for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}

test("drops: create a drop with a preview, publish it", async ({ page }) => {
  await page.goto("/ops/");
  await setTime(page, "2026-10-02T09:00:00-07:00");
  await page.getByLabel("Email").fill("ops@e2e.test");
  await page.getByLabel("Password").fill("ops password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: /Drops/ })).toBeVisible();
  await page.keyboard.press("d");
  await page.getByTestId("new-drop").click();
  await page.getByTestId("drop-starts").fill("2026-10-10T12:00");
  await page.getByTestId("drop-packs").fill("60");
  await expect(page.getByTestId("drop-preview")).toContainText("Sat, Oct 10, 12:00 PM PT");
  await expect(page.getByTestId("drop-preview")).toContainText("Not shown to customers");
  await page.getByTestId("drop-status").selectOption("published");
  await page.getByTestId("save-drop").click();
  await expect(page.getByTestId("drop-FDN")).toContainText("published, upcoming");
  await expect(page.getByTestId("drop-FDN")).toContainText("0 / 60");
  await shot(page, "7-drops");
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
  // Section 15: the set can't go on sale until its card data is imported and checked.
  await expect(card.getByTestId("toggle")).toBeDisabled();
  await expect(card.getByTestId("card-data")).toContainText("not checked");
  await card.getByTestId("check-cards").click();
  await expect(card.getByTestId("card-data")).toContainText("Card data: checked, 2 printings");
  // And customers always see the real pack: no photo, no sale.
  await expect(card.getByTestId("toggle")).toBeDisabled();
  await card.getByTestId("pack-photo-url").fill("/packs/fdn.jpg");
  await card.getByTestId("save-photo").click();
  await expect(card.getByTestId("toggle")).toBeEnabled();
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
