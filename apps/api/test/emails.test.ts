import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeProduct, makeUser } from "../../../packages/db/test/fixtures";
import { renderEmail, ADDRESS_PLACEHOLDER } from "../src/email-templates";
import { logEmail, type EmailKind, type EmailMessage } from "../src/email";
import { runEmailJobs } from "../src/jobs";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";

// Item 15: every template, HTML and plain text, and the rules they follow.
const ctx: { appUrl: string; mailingAddress: string | null } = { appUrl: "https://crackapack.test", mailingAddress: "PO Box 1, Sacramento, CA 95814" };
const SAMPLES: Record<EmailKind, Record<string, unknown>> = {
  order_confirmation: { packs: 3, set_name: "Foundations", credits: 2850 },
  pack_cracked: { packs: 3, set_name: "Foundations", url: "https://crackapack.test/vault" },
  shipping_confirmation: { cards: 5, tracking: "9400TEST" },
  sellback_receipt: { cards: 2, credits: 450, hold_until: null },
  limit_changed: { period: "weekly", credits: 5000, pending: false },
  break_started: { until: "2026-10-08T19:00:00Z" },
  break_ended: { lifted: false },
  drop_reminder: { set_name: "Foundations", starts_at: "2026-10-03T19:00:00Z", unsubscribe_url: "https://crackapack.test/api/drops/unsubscribe/tok" },
  password_reset: { link: "https://crackapack.test/reset-password?token=abc" },
  staff_alert: { title: "Foundations sold out", body: "Receive more boxes." },
};
const render = (kind: EmailKind, data = SAMPLES[kind], c = ctx) => renderEmail({ kind, to: "a@x.test", data }, c);

describe("email templates", () => {
  it("renders every kind as HTML and text with the support address and no dashes in the copy", () => {
    for (const kind of Object.keys(SAMPLES) as EmailKind[]) {
      const r = render(kind);
      expect(r.subject.length, kind).toBeGreaterThan(5);
      expect(r.html, kind).toMatch(/^<!doctype html>/);
      expect(r.text, kind).toContain("crackapack.business@gmail.com");
      expect(r.html, kind).toContain("crackapack.business@gmail.com");
      // No hype words, and no values advertised.
      expect(r.text.toLowerCase(), kind).not.toMatch(/unleash|thrill|level up|big hit|jackpot|lucky|streak|bonus/);
      expect(r.text, kind).not.toMatch(/ — | – /);
    }
  });

  it("states the 7:00 PM cutoff in the order confirmation", () => {
    expect(render("order_confirmation").text).toContain("The queue locks at 7:00 PM PT.");
  });

  it("never names cards or shows values in the cracked email", () => {
    const r = render("pack_cracked");
    expect(r.subject).toBe("You just cracked a pack");
    expect(r.text).not.toMatch(/\$|credits|mythic|rare|value/i);
    expect(r.text).toContain("Open your Vault: https://crackapack.test/vault");
  });

  it("puts the mailing address and an unsubscribe link only in the commercial drop reminder", () => {
    const r = render("drop_reminder");
    expect(r.text).toContain("PO Box 1, Sacramento, CA 95814");
    expect(r.text).toContain("Unsubscribe from this reminder: https://crackapack.test/api/drops/unsubscribe/tok");
    expect(r.html).toContain('href="https://crackapack.test/api/drops/unsubscribe/tok"');
    expect(render("drop_reminder", SAMPLES.drop_reminder, { appUrl: ctx.appUrl, mailingAddress: null }).text).toContain(ADDRESS_PLACEHOLDER);
    expect(render("pack_cracked").text).not.toContain("Unsubscribe");
  });

  it("escapes anything that came from data", () => {
    const r = render("staff_alert", { title: "<script>x</script>", body: "a & b" });
    expect(r.html).not.toContain("<script>x");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("describes pending and immediate limit changes plainly", () => {
    expect(render("limit_changed").text).toContain("Your weekly limit is now 5,000 credits.");
    expect(render("limit_changed", { period: "daily", credits: null, pending: true, at: "2026-10-02T19:00:00Z" }).text)
      .toContain("Your daily limit will be removed.\n\nThis takes effect Fri, Oct 2, 12:00 PM PT.");
  });
});

describe("email jobs", () => {
  let db: Db;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(async () => { await db.close(); });

  it("sends each drop reminder and break ended email once", async () => {
    await makeProduct(db, { setCode: "EEE" });
    const u = await makeUser(db);
    const [{ id }] = await db.q("select save_drop(null, 'EEE', '2026-10-01T12:00:00-07:00', null, 10, null, 'published', null) as id");
    await db.q("select set_config('app.now_override', '2026-10-01T09:00:00-07:00', false)");
    await db.q("select request_drop_reminder($1, $2, 'tok')", [id, u]);
    await db.q("select take_break($1, 24)", [u]);
    const sent: EmailMessage[] = [];
    const run = (at: string) => runEmailJobs(poolAt(db, at), logEmail(sent), "https://crackapack.test");
    expect(await run("2026-10-01T09:30:00-07:00")).toEqual({ reminders: 0, breaks: 0 });
    expect(await run("2026-10-01T11:10:00-07:00")).toEqual({ reminders: 1, breaks: 0 });
    expect(await run("2026-10-01T11:20:00-07:00")).toEqual({ reminders: 0, breaks: 0 });
    expect(await run("2026-10-02T10:00:00-07:00")).toEqual({ reminders: 0, breaks: 1 });
    expect(await run("2026-10-02T10:15:00-07:00")).toEqual({ reminders: 0, breaks: 0 });
    expect(sent.map((m) => m.kind)).toEqual(["drop_reminder", "break_ended"]);
    expect(sent[0].data.unsubscribe_url).toBe("https://crackapack.test/api/drops/unsubscribe/tok");
  });
});

/** A pool whose every query runs at a pinned time (test mode only). */
function poolAt(db: Db, at: string) {
  return { query: async (sql: string, params?: unknown[]) => {
    const c = await db.pool.connect();
    try { await c.query("select set_config('app.now_override', $1, false)", [at]); return await c.query(sql, params); }
    finally { await c.query("select set_config('app.now_override', '', false)"); c.release(); }
  } } as never;
}

describe("emails over the API", () => {
  let db: Db;
  beforeEach(async () => { db = await freshDb(); });
  afterEach(async () => { await db.close(); });

  it("confirms an order and alerts staff when a set sells out", async () => {
    const sent: EmailMessage[] = [];
    const app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: true, clips: linkClips, testClock: true, email: logEmail(sent) });
    const p = await makeProduct(db, { packsPerBox: 2, buffer: 0 });
    const login = await (await app.request("/dev/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "u@x.test", verified: true }) })).json() as { token: string; user_id: string };
    await db.q("select purchase_credits($1, 5000, 'seed')", [login.user_id]);
    const r = await app.request("/orders", { method: "POST", body: JSON.stringify({ product_id: p, quantity: 2 }),
      headers: { "content-type": "application/json", authorization: `Bearer ${login.token}`, "x-test-now": "2026-10-01T12:00:00-07:00" } });
    expect(r.status).toBe(201);
    expect(sent.map((m) => [m.kind, m.to])).toEqual([["order_confirmation", "u@x.test"], ["staff_alert", "crackapack.business@gmail.com"]]);
    expect(renderEmail(sent[1], ctx).subject).toMatch(/sold out$/);
  });
});
