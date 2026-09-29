import { expect, test } from "@playwright/test";

const API = "http://localhost:8789";

// Item 14: a guest sees when a set goes live, counts down on server time, and can add it to a calendar.
test("a guest sees an upcoming drop with a countdown on server time and calendar links", async ({ page, request }) => {
  const staff = await (await request.post(`${API}/dev/login`, { data: { email: "ops@e2e.test", role: "staff" } })).json();
  // M10 isn't on sale in the other specs, so this drop never gates their orders. A drop needs the set's real pack photo.
  await request.put(`${API}/staff/sets/M10`, { headers: { authorization: `Bearer ${staff.token}` }, data: { pack_image_url: "/packs/fdn.jpg" } });
  const r = await request.post(`${API}/staff/drops`, { headers: { authorization: `Bearer ${staff.token}` },
    data: { set_code: "M10", starts_at: "2026-10-03T12:00:00-07:00", packs_allocated: 60, status: "published" } });
  expect(r.ok(), await r.text()).toBeTruthy();

  await page.goto("/drops");
  // The phone's clock is wrong on purpose; the countdown follows the server.
  await page.evaluate(() => localStorage.setItem("crackapack.testNow", "2026-10-01T12:00:00-07:00"));
  await page.clock.setFixedTime(new Date("2030-01-01T00:00:00Z"));
  await page.reload();
  const card = page.getByTestId("drop-M10");
  await expect(card.getByTestId("drop-state")).toHaveText("Upcoming");
  await expect(card.getByTestId("countdown")).toHaveAccessibleName(/^2 days 0 hours 0 minutes until live$/);
  await expect(card).toContainText("Sat, Oct 3, 12:00 PM PT");
  const ics = await request.get(`${API}/drops/${(await (await request.get(`${API}/drops`)).json()).drops.find((d: { set_code: string }) => d.set_code === "M10").id}/calendar.ics`);
  expect(ics.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  await expect(card.getByTestId("add-google")).toBeVisible();
  // Reminders need an account.
  await card.getByTestId("remind").click();
  await expect(page).toHaveURL(/\/sign-in$/);
  if (process.env.SCREENSHOTS) { await page.goto("/drops"); await page.screenshot({ path: `${process.env.SCREENSHOTS}/m7-drops.png` }); }
});
