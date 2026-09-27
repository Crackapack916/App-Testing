import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb, type Db } from "../../../packages/db/test/db";
import { expoPush } from "../src/push";
import { createApp } from "../src/app";

let db: Db;
beforeEach(async () => { db = await freshDb(); });
afterEach(async () => { await db.close(); });

describe("expo push", () => {
  it("registers a device over the API, sends to it, and drops tokens Expo rejects", async () => {
    const app = createApp({ pool: db.pool, jwtSecret: "s", push: { send: async () => {} }, devLogin: true, testClock: false });
    const login = await (await app.request("/dev/login", { method: "POST", body: JSON.stringify({ email: "a@x.test" }) })).json() as any;
    const auth = { authorization: `Bearer ${login.token}`, "content-type": "application/json" };
    for (const token of ["ExponentPushToken[good]", "ExponentPushToken[gone]"]) {
      const r = await app.request("/me/push-token", { method: "POST", headers: auth, body: JSON.stringify({ token, platform: "ios" }) });
      expect(r.status).toBe(200);
    }
    const bad = await app.request("/me/push-token", { method: "POST", headers: auth, body: JSON.stringify({ token: "nope", platform: "ios" }) });
    expect(bad.status).toBe(400);

    const sent: any[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const msgs = JSON.parse(String(init.body));
      sent.push(...msgs);
      return new Response(JSON.stringify({ data: msgs.map((m: any) => m.to.includes("gone")
        ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "t1" }) }));
    }) as unknown as typeof fetch;
    await expoPush(db.pool, fakeFetch).send(login.user_id, "You just cracked a pack", "Your pull is in your vault.", { screen: "vault" });
    expect(sent.map((m) => [m.to, m.title, m.data.screen])).toEqual([
      ["ExponentPushToken[good]", "You just cracked a pack", "vault"], ["ExponentPushToken[gone]", "You just cracked a pack", "vault"],
    ]);
    expect((await db.q("select token from push_tokens")).map((r) => r.token)).toEqual(["ExponentPushToken[good]"]);
  });

  it("does nothing for a customer with no devices", async () => {
    let called = false;
    const [u] = await db.q("insert into users (email) values ('b@x.test') returning id");
    await expoPush(db.pool, (async () => { called = true; return new Response("{}"); }) as any).send(u.id, "t", "b", {});
    expect(called).toBe(false);
  });
});
