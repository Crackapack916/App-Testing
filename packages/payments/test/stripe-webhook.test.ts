import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../db/test/db";
import { makeUser } from "../../db/test/fixtures";
import { StripeProcessor, handleWebhook } from "../src";

const SECRET = "whsec_test_secret";
const processor = new StripeProcessor({ secretKey: "sk_test_dummy", webhookSecret: SECRET, livemode: false });
const stripe = new Stripe("sk_test_dummy");

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

let n = 0;
function signed(type: string, object: object, extra: { livemode?: boolean; previous?: object } = {}) {
  const body = JSON.stringify({
    id: `evt_${++n}_${Date.now()}`, object: "event", type, livemode: extra.livemode ?? false, api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: { object, ...(extra.previous ? { previous_attributes: extra.previous } : {}) },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return { body, headers: { "stripe-signature": header } };
}

const session = (userId: string, credits: number, paid = credits) => ({
  id: `cs_test_${userId.slice(0, 8)}_${credits}`, object: "checkout.session", payment_status: "paid",
  amount_total: paid, currency: "usd", client_reference_id: userId,
  metadata: { user_id: userId, credits: String(credits), bundle: `credits_${credits}` },
});
const balance = (u: string) => db.one("select purchased::int, earned::int from credit_accounts where user_id = $1", [u]);

describe("stripe webhooks", () => {
  it("credits a paid checkout once, even when delivered twice", async () => {
    const u = await makeUser(db);
    const ev = signed("checkout.session.completed", session(u, 2550));
    expect(await handleWebhook(db.pool, processor, ev.body, ev.headers)).toEqual({ status: "applied" });
    expect(await handleWebhook(db.pool, processor, ev.body, ev.headers)).toEqual({ status: "duplicate" });
    expect(await balance(u)).toEqual({ purchased: 2550, earned: 0 });
  });

  it("credits once when two deliveries race", async () => {
    const u = await makeUser(db);
    const ev = signed("checkout.session.completed", session(u, 900));
    const results = await Promise.all([1, 2, 3].map(() => handleWebhook(db.pool, processor, ev.body, ev.headers)));
    expect(results.filter((r) => r.status === "applied")).toHaveLength(1);
    expect(await balance(u)).toEqual({ purchased: 900, earned: 0 });
  });

  it("does not double credit a session reported by both completion events", async () => {
    const u = await makeUser(db);
    const a = signed("checkout.session.completed", session(u, 900));
    const b = signed("checkout.session.async_payment_succeeded", session(u, 900));
    expect(await handleWebhook(db.pool, processor, a.body, a.headers)).toEqual({ status: "applied" });
    expect(await handleWebhook(db.pool, processor, b.body, b.headers)).toEqual({ status: "ignored", detail: "already_credited" });
    expect(await balance(u)).toEqual({ purchased: 900, earned: 0 });
  });

  it("rejects a forged signature", async () => {
    const u = await makeUser(db);
    const ev = signed("checkout.session.completed", session(u, 9300));
    const tampered = ev.body.replace('"9300"', '"930000"');
    expect(() => processor.parseWebhook(tampered, ev.headers)).toThrow();
    await expect(handleWebhook(db.pool, processor, ev.body, {})).rejects.toThrow(/missing_signature/);
  });

  it("ignores unpaid sessions, amount mismatches, live events in test mode and unknown types", async () => {
    const u = await makeUser(db);
    const cases = [
      signed("checkout.session.completed", { ...session(u, 900), payment_status: "unpaid" }),
      signed("checkout.session.completed", session(u, 9300, 900)),
      signed("checkout.session.completed", session(u, 900), { livemode: true }),
      signed("customer.created", { id: "cus_1", object: "customer" }),
    ];
    const out = [];
    for (const c of cases) out.push((await handleWebhook(db.pool, processor, c.body, c.headers)).detail);
    expect(out).toEqual(["not_paid", "amount_mismatch", "wrong_mode", "unhandled_type"]);
    expect(await db.q("select * from credit_accounts where user_id = $1", [u])).toEqual([]);
    expect(Number((await db.one("select count(*) from payment_events where status = 'ignored'")).count)).toBe(4);
  });

  it("removes refunded credit, and flags a refund of credit already spent for review", async () => {
    const u = await makeUser(db);
    const buy = signed("checkout.session.completed", session(u, 2550));
    await handleWebhook(db.pool, processor, buy.body, buy.headers);

    const charge = (refunded: number) => ({ id: "ch_1", object: "charge", amount: 2550, amount_refunded: refunded, metadata: { user_id: u } });
    const r1 = signed("charge.refunded", charge(1000), { previous: { amount_refunded: 0 } });
    expect(await handleWebhook(db.pool, processor, r1.body, r1.headers)).toEqual({ status: "applied" });
    expect(await balance(u)).toEqual({ purchased: 1550, earned: 0 });

    await db.q("insert into credit_entries (user_id, bucket, amount, kind) values ($1, 'purchased', -1500, 'pack_order')", [u]);
    const r2 = signed("charge.refunded", charge(2550), { previous: { amount_refunded: 1000 } });
    expect(await handleWebhook(db.pool, processor, r2.body, r2.headers)).toEqual({ status: "needs_review", detail: "credit_already_spent" });
    expect(await balance(u)).toEqual({ purchased: 50, earned: 0 });
    const review = await db.one("select credits::int, status from payment_events where status = 'needs_review'");
    expect(review).toEqual({ credits: 1550, status: "needs_review" });
  });
});
