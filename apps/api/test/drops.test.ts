import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";

// Items 5, 9 and 14 over HTTP: drops, calendar files, reminders, and each set's state on the storefront.
let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  db = await freshDb();
  app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: true, clips: linkClips, devStaffEmails: ["ops@x.test"], testClock: true,
    appUrl: "https://crackapack.test" });
});
afterEach(async () => { await db.close(); });

const req = (method: string, path: string, o: { token?: string; at?: string; body?: unknown } = {}) => app.request(path, { method,
  headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.at ? { "x-test-now": o.at } : {}) },
  body: o.body === undefined ? undefined : JSON.stringify(o.body) });
const json = async (method: string, path: string, o: { token?: string; at?: string; body?: unknown } = {}) => {
  const r = await req(method, path, o); return { status: r.status, body: await r.json() as any };
};
const login = async (email: string, role = "customer") => (await json("POST", "/dev/login", { body: { email, role, verified: true } })).body;

const MORNING = "2026-10-01T09:00:00-07:00";
const LIVE = "2026-10-01T12:30:00-07:00";

describe("drops over HTTP", () => {
  it("lets staff create a drop, shows it to guests with a countdown clock, a calendar file and a Google link", async () => {
    const p = await makeProduct(db, { setCode: "EEE" });
    const staff = await login("ops@x.test", "staff");
    const bad = await json("POST", "/staff/drops", { token: staff.token, body: { set_code: "EEE", starts_at: "2026-10-01T12:00:00-07:00", ends_at: "2026-10-01T11:00:00-07:00", packs_allocated: 10, status: "published" } });
    expect(bad.body.error).toBe("invalid_drop_window");
    const { id } = (await json("POST", "/staff/drops", { token: staff.token, body: { set_code: "eee", starts_at: "2026-10-01T12:00:00-07:00", packs_allocated: 10, per_customer_limit: 3, status: "published" } })).body;

    const list = (await json("GET", "/drops", { at: MORNING })).body;
    expect(list.now).toBe("2026-10-01T16:00:00.000Z");
    expect(list.drops).toHaveLength(1);
    expect(list.drops[0]).toMatchObject({ id, set_code: "EEE", state: "upcoming", reminded: false });
    expect(list.drops[0].google_calendar_url).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);

    const ics = await req("GET", `/drops/${id}/calendar.ics`);
    expect(ics.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(ics.headers.get("content-disposition")).toContain("crackapack-eee.ics");
    const text = await ics.text();
    expect(text).toContain("DTSTART:20261001T190000Z");
    expect(text).toContain("URL:https://crackapack.test/drops");

    // Storefront: upcoming before the window, then available up to the drop's own limit.
    expect((await json("GET", "/storefront", { at: MORNING })).body.products[0]).toMatchObject({ product_id: p, status: "upcoming", max_qty: 0 });
    const u = await login("u@x.test");
    await db.q("select purchase_credits($1, 20000, 'seed')", [u.user_id]);
    expect((await json("GET", "/storefront", { token: u.token, at: LIVE })).body.products[0]).toMatchObject({ status: "available", left_for_you: 3, max_qty: 3 });
    await json("POST", "/orders", { token: u.token, at: LIVE, body: { product_id: p, quantity: 3 } });
    expect((await json("GET", "/storefront", { token: u.token, at: LIVE })).body.products[0]).toMatchObject({ status: "limit_reached", left_for_you: 0 });
    const over = await json("POST", "/orders", { token: u.token, at: LIVE, body: { product_id: p, quantity: 1 } });
    expect([over.status, over.body.error]).toEqual([409, "set_limit_reached"]);
    // Guests still see it as available.
    expect((await json("GET", "/storefront", { at: LIVE })).body.products[0].status).toBe("available");
  });

  it("takes an email reminder opt in and unsubscribes from the emailed link without signing in", async () => {
    await makeProduct(db, { setCode: "EEE" });
    const staff = await login("ops@x.test", "staff");
    const { id } = (await json("POST", "/staff/drops", { token: staff.token, body: { set_code: "EEE", starts_at: "2026-10-01T12:00:00-07:00", packs_allocated: 10, status: "published" } })).body;
    const u = await login("u@x.test");
    expect((await json("POST", `/drops/${id}/remind`)).status).toBe(401);
    expect((await json("POST", `/drops/${id}/remind`, { token: u.token, at: MORNING })).status).toBe(200);
    expect((await json("GET", "/drops", { token: u.token, at: MORNING })).body.drops[0].reminded).toBe(true);
    const { token } = await db.one("select token from drop_reminders");
    const page = await req("GET", `/drops/unsubscribe/${token}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("You won't get this drop reminder");
    expect((await json("GET", "/drops", { token: u.token, at: MORNING })).body.drops[0].reminded).toBe(false);
    expect((await req("GET", "/drops/unsubscribe/nope")).status).toBe(404);
  });

  it("shows break and sold out states", async () => {
    const p = await makeProduct(db, { setCode: "FFF", packsPerBox: 1, buffer: 0 });
    const [a, b] = [await login("a@x.test"), await login("b@x.test")];
    for (const x of [a, b]) await db.q("select purchase_credits($1, 20000, 'seed')", [x.user_id]);
    await json("POST", "/orders", { token: a.token, at: MORNING, body: { product_id: p, quantity: 1 } });
    expect((await json("GET", "/storefront", { token: b.token, at: MORNING })).body.products[0]).toMatchObject({ status: "sold_out", sold_out: true });
    await json("POST", "/me/break", { token: b.token, at: MORNING, body: { hours: 24 } });
    const s = (await json("GET", "/storefront", { token: b.token, at: MORNING })).body;
    expect(s.products[0].status).toBe("on_break");
    expect(s.break_until).toBeTruthy();
  });
});
