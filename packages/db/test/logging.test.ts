import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atTime, freshDb, type Db } from "./db";
import { AT_CUTOFF, BEFORE_CUTOFF, makeCard, makeProduct, makeStaff, makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

const T = "2026-10-01T19:10:00-07:00";
const run = (sql: string, params: unknown[] = []) => atTime(db, T, sql, params);

/** One customer, one pack, opened from the locked queue. */
async function openedPack() {
  const user = await makeUser(db, { credits: 5000 });
  const product = await makeProduct(db, { setCode: "LOG" });
  const staff = await makeStaff(db);
  const [{ id: o }] = await atTime(db, BEFORE_CUTOFF, "select place_order($1, $2, 1) as id", [user, product]);
  const { batch_id } = await db.one("select batch_id from orders where id = $1", [o]);
  await atTime(db, AT_CUTOFF, "select lock_batch($1, $2)", [batch_id, staff]);
  const [{ s }] = await run("select start_session($1, $2, null) as s", [batch_id, staff]);
  const box = (await db.one("select id from sealed_boxes where product_id = $1", [product])).id;
  await run("select open_box($1, $2, 0, $3)", [s, box, staff]);
  const [p] = await run("select * from open_next_pack($1, 0, $2)", [s, staff]);
  return { user, staff, pack: p.pack_opening_id as string };
}
const log = (pack: string, slot: number, card: string | null, finish: string | null, staff: string, kind = "card") =>
  run("select log_pack_card($1, $2, $3, $4, $5, 'NM', null, $6)", [pack, slot, kind, card, finish, staff]);

describe("logging a pack", () => {
  it("only logs finishes the printing has, and accepts a token or ad slot that never reaches the vault", async () => {
    const { user, staff, pack } = await openedPack();
    const plain = await makeCard(db, { set: "LOG", num: "12a", priceCents: 30 });
    await db.q("update cards set finishes = '{nonfoil}' where id = $1", [plain]);
    await expect(log(pack, 1, plain, "foil", staff)).rejects.toThrow(/finish_not_available/);
    await log(pack, 1, plain, "nonfoil", staff);
    await log(pack, 2, null, null, staff, "token");
    await run("select finalize_pack_contents($1, $2)", [pack, staff]);
    expect(await db.q("select card_id, qty from vault_balances where user_id = $1", [user])).toEqual([{ card_id: plain, qty: 1 }]);
    expect(await db.q("select slot, kind from pack_contents where pack_opening_id = $1 order by slot", [pack]))
      .toEqual([{ slot: 1, kind: "card" }, { slot: 2, kind: "token" }]);
  });

  it("refuses logging for anything that isn't an opened pack from the locked queue", async () => {
    const staff = await makeStaff(db);
    const card = await makeCard(db, { set: "LOG" });
    await expect(log("00000000-0000-0000-0000-000000000000", 1, card, "nonfoil", staff)).rejects.toThrow();
    await expect(db.q("insert into pack_openings (session_id, batch_id, box_id, pack_number_in_box, status, opened_at) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'opened', now())"))
      .rejects.toThrow();
  });

  it("warns on a card count that differs from the set's slot count, and needs a written override", async () => {
    const { staff, pack } = await openedPack();
    await db.q("update mtg_sets set slot_count = 14 where code = 'LOG'");
    const card = await makeCard(db, { set: "LOG" });
    for (let s = 1; s <= 13; s++) await log(pack, s, card, "nonfoil", staff);
    await log(pack, 14, null, null, staff, "ad");              // an ad slot doesn't count as a card
    await expect(run("select finalize_pack_contents($1, $2)", [pack, staff])).rejects.toThrow(/card_count_mismatch/);
    await expect(run("select finalize_pack_contents($1, $2, '  ')", [pack, staff])).rejects.toThrow(/card_count_mismatch/);
    await run("select finalize_pack_contents($1, $2, 'Misprint: 13 cards, shown on camera')", [pack, staff]);
    expect((await db.one("select count_override_reason from pack_openings where id = $1", [pack])).count_override_reason)
      .toBe("Misprint: 13 cards, shown on camera");
  });

  it("locks the pack at approval; a change after needs a reason, moves the vault, and keeps the full history", async () => {
    const { user, staff, pack } = await openedPack();
    const wrong = await makeCard(db, { set: "LOG", num: "1", priceCents: 10 });
    const right = await makeCard(db, { set: "LOG", num: "2", priceCents: 10 });
    await log(pack, 1, right, "nonfoil", staff);
    await log(pack, 1, wrong, "nonfoil", staff);                               // edit before approval
    await run("select finalize_pack_contents($1, $2)", [pack, staff]);
    await expect(log(pack, 1, right, "nonfoil", staff)).rejects.toThrow(/pack_contents_finalized/);
    await expect(run("select clear_pack_card($1, 1, $2)", [pack, staff])).rejects.toThrow(/pack_contents_finalized/);
    await expect(run("select amend_pack_card($1, 1, 'card', $2, 'nonfoil', ' ', $3)", [pack, right, staff])).rejects.toThrow(/reason_required/);
    await run("select amend_pack_card($1, 1, 'card', $2, 'nonfoil', 'Video shows #2, typed #1', $3)", [pack, right, staff]);
    expect(await db.q("select card_id, qty from vault_balances where user_id = $1 and qty > 0", [user])).toEqual([{ card_id: right, qty: 1 }]);
    expect(await db.q("select * from vault_invariant_violations")).toEqual([]);
    const ev = await db.q("select action, card_id, old_card_id, reason from pack_content_events where pack_opening_id = $1 order by id", [pack]);
    expect(ev.map((e) => e.action)).toEqual(["logged", "changed", "approved", "amended"]);
    expect(ev[3]).toMatchObject({ card_id: right, old_card_id: wrong, reason: "Video shows #2, typed #1" });
    expect(await db.q("select event_type from custody_events where event_type = 'contents_amended'")).toHaveLength(1);
  });

  it("refuses to amend a card that has already left the customer's vault", async () => {
    const { user, staff, pack } = await openedPack();
    const card = await makeCard(db, { set: "LOG", priceCents: 10 });
    await log(pack, 1, card, "nonfoil", staff);
    await run("select finalize_pack_contents($1, $2)", [pack, staff]);
    await run("select request_shipment($1, $2, '{}')", [user, JSON.stringify([{ card_id: card, finish: "nonfoil", qty: 1 }])]);
    await expect(run("select amend_pack_card($1, 1, null, null, null, 'remove', $2)", [pack, staff])).rejects.toThrow(/card_left_vault/);
  });
});
