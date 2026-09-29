import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { makeCard, makeProduct } from "../../../packages/db/test/fixtures";
import { createApp } from "../src/app";
import { linkClips } from "../src/clips";
import { logEmail, type EmailMessage } from "../src/email";
import { runCardDataChecks } from "../src/jobs";

// Business context section 15 over the API and the scheduled jobs.
let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

describe("card data checks", () => {
  it("re-checks sets on sale, pauses orders when one fails, alerts staff once, and shows the set as unavailable", async () => {
    const p = await makeProduct(db, { setCode: "GAT" });
    await db.q("select record_set_printings('GAT', array['1'])");
    const card = await makeCard(db, { set: "GAT", num: "1" });
    await db.q(`insert into card_images (card_id, source, uris) values ($1, 'scryfall', '{"normal":"https://cards.test/n.jpg"}')`, [card]);
    const sent: EmailMessage[] = [];
    const email = logEmail(sent);
    expect(await runCardDataChecks(db.pool, email)).toEqual([{ set_code: "GAT", ok: true }]);
    expect(sent).toEqual([]);

    await db.q("delete from card_images");   // e.g. a bad import dropped the image
    expect(await runCardDataChecks(db.pool, email)).toEqual([{ set_code: "GAT", ok: false }]);
    expect(await runCardDataChecks(db.pool, email)).toEqual([{ set_code: "GAT", ok: false }]);
    expect(sent.map((m) => [m.kind, m.to, m.data.title])).toEqual([["staff_alert", "crackapack.business@gmail.com", "GAT card data failed its check"]]);

    const app = createApp({ pool: db.pool, jwtSecret: "s", devLogin: true, clips: linkClips, testClock: true });
    const store = await (await app.request("/storefront", { headers: { "x-test-now": "2026-10-01T12:00:00-07:00" } })).json() as any;
    expect(store.products.find((x: any) => x.product_id === p)).toMatchObject({ status: "unavailable", max_qty: 0 });
  });
});
