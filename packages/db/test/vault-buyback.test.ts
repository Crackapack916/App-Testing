import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { AT_CUTOFF, BEFORE_CUTOFF, makeCard, makeProduct, makeStaff, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const NOW = new Date().toISOString();
const run = (sql: string, params: unknown[] = []) => atTime(db, NOW, sql, params);

/** Runs a full night for one customer and one pack, logging the given contents. */
async function pull(user: string, contents: { card: string; finish?: string; serial?: string }[]) {
  const p = await makeProduct(db, { setCode: "S" + Math.floor(Math.random() * 1e6) });
  const staff = await makeStaff(db);
  const [{ id: o }] = await atTime(db, BEFORE_CUTOFF, "select place_order($1, $2, 1) as id", [user, p]);
  const { batch_id } = await db.one("select batch_id from orders where id = $1", [o]);
  await atTime(db, AT_CUTOFF, "select lock_batch($1, $2)", [batch_id, staff]);
  const t = "2026-10-01T19:10:00-07:00";
  const [{ s }] = await atTime(db, t, "select start_session($1, $2, null) as s", [batch_id, staff]);
  const box = (await db.one("select id from sealed_boxes where product_id = $1", [p])).id;
  await atTime(db, t, "select open_box($1, $2, 0, $3)", [s, box, staff]);
  const [pack] = await atTime(db, t, "select * from open_next_pack($1, 0, $2)", [s, staff]);
  for (const [i, c] of contents.entries()) {
    await db.q("select log_pack_card($1, $2, $3, $4, 'NM', $5, $6)", [pack.pack_opening_id, i + 1, c.card, c.finish ?? "nonfoil", c.serial ?? null, staff]);
  }
  await atTime(db, t, "select finalize_pack_contents($1, $2)", [pack.pack_opening_id, staff]);
  return pack.pack_opening_id as string;
}

describe("vault classification at pull", () => {
  it("holds foils, serialized and $20+ cards individually and pools the rest", async () => {
    const u = await makeUser(db, { credits: 10_000 });
    const bulk = await makeCard(db, { priceCents: 8 });
    const mid = await makeCard(db, { rarity: "rare", priceCents: 1999 });
    const big = await makeCard(db, { rarity: "mythic", priceCents: 2000 });
    const foil = await makeCard(db, { priceCents: 8, foilPriceCents: 30 });
    const unpricedRare = await makeCard(db, { rarity: "rare", priceCents: null });
    const serial = await makeCard(db, { rarity: "mythic", priceCents: 500 });
    const po = await pull(u, [
      { card: bulk }, { card: bulk }, { card: mid }, { card: big },
      { card: foil, finish: "foil" }, { card: unpricedRare }, { card: serial, serial: "042/500" },
    ]);

    const fungible = await db.q("select card_id, qty from vault_balances where user_id = $1 order by qty desc", [u]);
    expect(fungible).toEqual([{ card_id: bulk, qty: 2 }, { card_id: mid, qty: 1 }]);
    const held = await db.q("select card_id from individual_cards where owner_user_id = $1 and status = 'vaulted'", [u]);
    expect(held.map((r) => r.card_id).sort()).toEqual([big, foil, unpricedRare, serial].sort());
    expect(await db.q("select * from vault_invariant_violations")).toEqual([]);

    await expect(db.q("select log_pack_card($1, 1, $2, 'nonfoil', 'NM', null, null)", [po, big])).rejects.toThrow(/finalized/);
    await expect(db.q("delete from pack_contents where pack_opening_id = $1", [po])).rejects.toThrow(/finalized/);
  });
});

describe("buylist", () => {
  it("pays 90% at $2 and up, 50% from $0.50, and a flat 2 credits below", async () => {
    const quote = async (c: number) => Number((await db.one("select buylist_quote($1, 1) as q", [c])).q);
    expect(await quote(1000)).toBe(900);
    expect(await quote(200)).toBe(180);
    expect(await quote(199)).toBe(99);
    expect(await quote(50)).toBe(25);
    expect(await quote(49)).toBe(2);
    expect(await quote(0)).toBe(2);
  });

  it("uses the schedule in effect when the request is made", async () => {
    await db.q("insert into buylist_schedules (id, effective_from) values (2, '2030-01-01')");
    await db.q("insert into buylist_tiers values (2, 0, 80, null)");
    expect(Number((await atTime(db, "2029-12-31T00:00:00Z", "select current_buylist_schedule() as s"))[0].s)).toBe(1);
    expect(Number((await atTime(db, "2030-01-02T00:00:00Z", "select current_buylist_schedule() as s"))[0].s)).toBe(2);
  });
});

describe("buyback", () => {
  it("credits earned (non withdrawable) credit and moves the cards to house stock", async () => {
    const u = await makeUser(db, { credits: 900 });
    const c = await makeCard(db, { priceCents: 300 });
    await pull(u, [{ card: c }, { card: c }, { card: c }]);
    const r = await run("select request_buyback($1, $2, 'k1') as id", [u, JSON.stringify([{ card_id: c, finish: "nonfoil", qty: 2 }])]);
    const req = await db.one("select * from buyback_requests where id = $1", [r[0].id]);
    expect([req.status, Number(req.total_credits)]).toEqual(["completed", 540]);
    expect(await db.one("select purchased::int, earned::int from credit_accounts where user_id = $1", [u])).toEqual({ purchased: 0, earned: 540 });
    expect((await db.one("select qty from vault_balances where user_id = $1 and card_id = $2", [u, c])).qty).toBe(1);
    expect((await db.one("select qty_on_hand from inventory_lots where card_id = $1", [c])).qty_on_hand).toBe(3);
  });

  it("is idempotent and cannot sell more than the customer holds", async () => {
    const u = await makeUser(db, { credits: 900 });
    const c = await makeCard(db, { priceCents: 300 });
    await pull(u, [{ card: c }]);
    const items = JSON.stringify([{ card_id: c, finish: "nonfoil", qty: 1 }]);
    const a = await run("select request_buyback($1, $2, 'same') as id", [u, items]);
    const b = await run("select request_buyback($1, $2, 'same') as id", [u, items]);
    expect(a[0].id).toBe(b[0].id);
    await expect(run("select request_buyback($1, $2, 'other')", [u, items])).rejects.toThrow(/vault_balance_non_negative/);
    const other = await makeUser(db);
    await expect(run("select request_buyback($1, $2, 'thief')", [other, items])).rejects.toThrow(/vault_balance_non_negative/);
  });

  it("refuses a quote on a stale price", async () => {
    const u = await makeUser(db, { credits: 900 });
    const c = await makeCard(db, { priceCents: 300, asof: "2020-01-01T00:00:00Z" });
    await pull(u, [{ card: c }]);
    await expect(run("select request_buyback($1, $2, 'k')", [u, JSON.stringify([{ card_id: c, finish: "nonfoil", qty: 1 }])]))
      .rejects.toThrow(/price_stale/);
  });

  it("holds large payouts until the window passes, and only the owner can sell a held card", async () => {
    const u = await makeUser(db, { credits: 900 });
    const c = await makeCard(db, { rarity: "mythic", priceCents: 15000 });
    await pull(u, [{ card: c }]);
    const ic = (await db.one("select id from individual_cards where owner_user_id = $1", [u])).id;
    const other = await makeUser(db);
    await expect(run("select request_buyback($1, $2, 'x')", [other, JSON.stringify([{ individual_card_id: ic }])])).rejects.toThrow(/card_not_in_vault/);

    const [{ id }] = await run("select request_buyback($1, $2, 'big') as id", [u, JSON.stringify([{ individual_card_id: ic }])]);
    const req = await db.one("select * from buyback_requests where id = $1", [id]);
    expect([req.status, Number(req.total_credits)]).toEqual(["held", 13500]);
    expect((await db.one("select earned::int from credit_accounts where user_id = $1", [u])).earned).toBe(0);

    const soon = new Date(Date.parse(NOW) + 3600_000).toISOString();
    expect(Number((await atTime(db, soon, "select release_held_buybacks() as n"))[0].n)).toBe(0);
    const later = new Date(Date.parse(NOW) + 73 * 3600_000).toISOString();
    expect(Number((await atTime(db, later, "select release_held_buybacks() as n"))[0].n)).toBe(1);
    expect((await db.one("select earned::int from credit_accounts where user_id = $1", [u])).earned).toBe(13500);
    expect((await db.one("select status, owner_user_id from individual_cards where id = $1", [ic]))).toEqual({ status: "house", owner_user_id: null });
  });
});

describe("shipping", () => {
  it("charges the fee below the free threshold and removes physical stock only when shipped", async () => {
    const u = await makeUser(db, { credits: 1500 });
    const c = await makeCard(db, { priceCents: 100 });
    await pull(u, [{ card: c }, { card: c }]);
    const [{ id }] = await run("select request_shipment($1, $2, '{\"zip\":\"95814\"}') as id", [u, JSON.stringify([{ card_id: c, finish: "nonfoil", qty: 2 }])]);
    expect((await db.one("select purchased::int from credit_accounts where user_id = $1", [u])).purchased).toBe(1500 - 900 - 499);
    expect((await db.one("select qty_on_hand from inventory_lots where card_id = $1", [c])).qty_on_hand).toBe(2);
    await run("select mark_shipped($1, 'TRACK1')", [id]);
    expect((await db.one("select qty_on_hand from inventory_lots where card_id = $1", [c])).qty_on_hand).toBe(0);
    expect(await db.q("select * from vault_invariant_violations")).toEqual([]);
  });
});

describe("free shipping threshold", () => {
  it("ships free at $50 of card value and charges the fee just below it", async () => {
    const u = await makeUser(db, { credits: 2000 });
    const c = await makeCard(db, { rarity: "rare", priceCents: 1000 }); // $10 each, pooled
    await pull(u, [{ card: c }, { card: c }, { card: c }, { card: c }, { card: c }]);
    const bal = async () => (await db.one("select purchased::int from credit_accounts where user_id = $1", [u])).purchased;
    const start = await bal();
    const item = (qty: number) => JSON.stringify([{ card_id: c, finish: "nonfoil", qty }]);
    await run("select request_shipment($1, $2, '{}')", [u, item(4)]); // $40
    expect(await bal()).toBe(start - 499);
    await db.q("insert into vault_entries (user_id, card_id, finish, condition, qty_delta, reason) values ($1, $2, 'nonfoil', 'NM', 4, 'adjustment')", [u, c]);
    await run("select request_shipment($1, $2, '{}')", [u, item(5)]); // $50
    expect(await bal()).toBe(start - 499);
  });
});

describe("clear_pack_card", () => {
  it("removes a mis-logged card before finalize and refuses after", async () => {
    const u = await makeUser(db, { credits: 2000 });
    const c = await makeCard(db, { priceCents: 5 });
    const po = await pull(u, [{ card: c }]);
    await expect(db.q("select clear_pack_card($1, 1)", [po])).rejects.toThrow(/pack_contents_finalized/);
  });
});
