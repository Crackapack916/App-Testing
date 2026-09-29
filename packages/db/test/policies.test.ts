import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "./db";
import { makeUser } from "./fixtures";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

describe("policies (item 18)", () => {
  it("publishes a current, dated version of each page", async () => {
    const rows = await db.q("select doc, current_policy_version(doc) as v from (values ('fairness'), ('terms'), ('privacy')) d(doc)");
    expect(rows).toEqual([{ doc: "fairness", v: "2026-10-02" }, { doc: "terms", v: "2026-10-02" }, { doc: "privacy", v: "2026-10-01" }]);
    await expect(db.q("update policy_versions set body_md = 'x'")).rejects.toThrow(/append_only/);
  });

  it("states the nightly limit per set and no fixed opening window", async () => {
    const text = (await db.q("select body_md from policy_versions p where version = current_policy_version(p.doc) and doc in ('fairness', 'terms')"))
      .map((r) => r.body_md).join("\n");
    expect(text).toContain("up to 6 packs of each set, shared by all customers");
    expect(text).toContain("There is no limit per customer.");
    expect(text).not.toMatch(/each customer can buy|between 7:00 and 8:00|on camera/);
  });

  it("requires the 18+ confirmation and current terms at the first purchase, once", async () => {
    const u = await makeUser(db);
    await expect(db.q("select assert_policies_accepted($1)", [u])).rejects.toThrow(/policies_not_accepted/);
    await db.q("select accept_policies_at_purchase($1)", [u]);
    await expect(db.q("select assert_policies_accepted($1)", [u])).resolves.toBeTruthy();
    expect(await db.q("select doc, version, context from policy_acceptances where user_id = $1 order by doc", [u])).toEqual([
      { doc: "privacy", version: "2026-10-01", context: "first_purchase" }, { doc: "terms", version: "2026-10-02", context: "first_purchase" }]);
    // A new terms version asks again.
    await db.q("insert into policy_versions (doc, version, published_at, title, body_md) values ('terms', '2026-11-01', now(), 'Terms', 'x')");
    await expect(db.q("select assert_policies_accepted($1)", [u])).rejects.toThrow(/policies_not_accepted/);
    await db.q("select accept_policies_at_purchase($1)", [u]);
    expect((await db.one("select context from policy_acceptances where user_id = $1 order by id desc limit 1", [u])).context).toBe("update");
    const young = await makeUser(db, { verified: false });
    await expect(db.q("select accept_policies_at_purchase($1)", [young])).rejects.toThrow(/age_not_verified/);
  });
});
