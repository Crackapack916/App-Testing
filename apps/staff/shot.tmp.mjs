import { chromium } from "@playwright/test";
const [S, ...pages] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 375, height: 667 } });
const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 150)));
for (const path of pages) {
  await p.goto("http://localhost:8800" + path.split("|")[0]);
  const q = path.split("|")[1]; if (q) { await p.getByTestId("search").fill(q); }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${S}/ds${path.split("|")[0].replace(/\W/g, "_")}.png` });
}
console.log(JSON.stringify(errs));
await b.close();
