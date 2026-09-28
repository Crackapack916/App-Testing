import { Hono } from "hono";
import { optionalUser, requireUser } from "../auth";
import { ApiError } from "../errors";
import { dropIcs, googleCalendarUrl } from "../calendar";
import { newToken } from "../secrets";
import type { Env } from "../context";

/** Drops (item 14): public, so guests can see what's coming and add it to a calendar. */
export const drops = new Hono<Env>();

const DROP_SQL = `
  select d.id, d.set_code, s.name as set_name, s.icon_svg_uri, s.pack_image_url, d.starts_at, d.ends_at, drop_state(d) as state,
         d.per_customer_limit, exists (select 1 from drop_reminders r where r.drop_id = d.id and r.user_id = $1 and r.unsubscribed_at is null) as reminded
  from drops d join mtg_sets s on s.code = d.set_code
  where d.status = 'published'`;
// Live first, then upcoming by start, then sold out, then ended in the last two weeks.
const ORDER = `order by array_position(array['live', 'upcoming', 'sold_out', 'ended'], drop_state(d)), d.starts_at`;

drops.use("/drops", optionalUser());
drops.get("/drops", async (c) => {
  const db = c.get("db");
  const { rows } = await db.query(
    `${DROP_SQL} and (d.ends_at is null or d.ends_at > app_now() - interval '14 days') ${ORDER}`, [c.get("user")?.id ?? null]);
  const { rows: [t] } = await db.query("select app_now() as now");
  const base = c.get("services").appUrl;
  return c.json({ now: t.now, drops: rows.map((d) => ({ ...d,
    google_calendar_url: d.state === "upcoming" ? googleCalendarUrl(event(d, base)) : null })) });
});

const event = (d: { id: string; set_name: string; starts_at: Date; ends_at: Date | null }, base: string) =>
  ({ id: d.id, setName: d.set_name, startsAt: new Date(d.starts_at), endsAt: d.ends_at ? new Date(d.ends_at) : null, url: `${base}/drops` });

drops.get("/drops/:id/calendar.ics", async (c) => {
  const { rows: [d] } = await c.get("db").query(`${DROP_SQL} and d.id = $2`, [null, c.req.param("id")]);
  if (!d) throw new ApiError("unknown_drop", 404);
  return c.body(dropIcs(event(d, c.get("services").appUrl)), 200, {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `attachment; filename="crackapack-${d.set_code.toLowerCase()}.ics"`,
  });
});

// Opt in email reminder one hour before; every reminder email carries its unsubscribe link.
drops.post("/drops/:id/remind", requireUser(), async (c) => {
  await c.get("db").query("select request_drop_reminder($1, $2, $3)", [c.req.param("id"), c.get("user").id, newToken()]);
  return c.json({ ok: true });
});

drops.delete("/drops/:id/remind", requireUser(), async (c) => {
  const { rows: [r] } = await c.get("db").query("select token from drop_reminders where drop_id = $1 and user_id = $2",
    [c.req.param("id"), c.get("user").id]);
  if (r) await c.get("db").query("select unsubscribe_drop_reminder($1)", [r.token]);
  return c.json({ ok: true });
});

// The link in the email. A plain page, so it works from any mail app without signing in.
drops.get("/drops/unsubscribe/:token", async (c) => {
  try { await c.get("db").query("select unsubscribe_drop_reminder($1)", [c.req.param("token")]); }
  catch { return c.html(page("This link has expired or was already used."), 404); }
  return c.html(page("You won't get this drop reminder. Nothing else about your account changed."));
});

const page = (msg: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrackAPack</title></head><body style="font-family:Georgia,serif;background:#D9DFE9;color:#252329;padding:32px 16px;max-width:520px;margin:auto">
<h1 style="font-size:22px">CrackAPack</h1><p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px">${msg}</p></body></html>`;
