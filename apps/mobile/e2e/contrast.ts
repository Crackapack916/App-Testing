import type { Page } from "@playwright/test";

/**
 * WCAG 2.2 AA contrast audit of what is on screen, the same math as the WebAIM contrast checker:
 * text 4.5:1 (3:1 at 24px, or 18.66px bold), icons and field edges 3:1 (1.4.11).
 * The background is what really sits behind each element: stacked fills, gradients (every stop
 * must pass) and parent opacity. Disabled controls and decorative art (data-decorative) are exempt, as WCAG allows. Text over a photo
 * or a card image is listed separately, since only a person can judge it.
 */
export type ContrastIssue = { screen: string; text: string; fg: string; bg: string; ratio: number; need: number; kind: string };

export async function auditContrast(page: Page, screen: string): Promise<ContrastIssue[]> {
  const found = await page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    const lum = (c: RGBA) => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const hex = (c: RGBA) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

    /** Every possible backdrop behind el: one per gradient stop; null when a photo is behind it. */
    const backdrops = (el: Element): RGBA[] | null => {
      const layers: { fills: RGBA[] }[] = [];
      let photo = false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const fills: RGBA[] = [];
        if (cs.backgroundImage.includes("url(") || n.tagName === "IMG" || n.tagName === "VIDEO") photo = true;
        if (cs.backgroundImage.includes("gradient")) {
          for (const m of cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) fills.push(parse(m[0])!);
        }
        const bg = parse(cs.backgroundColor);
        if (bg && bg[3] > 0) fills.push(bg);
        if (fills.length) {
          layers.push({ fills });
          if (fills.every((f) => f[3] >= 1)) break;
        }
        // An absolutely placed box over an image (the reel bar, a card badge) sits on that image.
        if (cs.position === "absolute" || cs.position === "fixed") {
          const r = n.getBoundingClientRect();
          const under = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (under.some((u) => !n!.contains(u) && (u.tagName === "IMG" || u.tagName === "VIDEO" || getComputedStyle(u).backgroundImage.includes("url(")))) photo = true;
        }
      }
      if (photo) return null;
      let out: RGBA[] = [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) {
        const next: RGBA[] = [];
        for (const base of out) for (const f of layer.fills) next.push(over(f, base));
        out = next;
      }
      return out;
    };
    const opacity = (el: Element) => { let o = 1; for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    const disabled = (el: Element) => !!el.closest('[aria-disabled="true"],[disabled]');
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && opacity(el) > 0.05;
    };

    const issues: { text: string; fg: string; bg: string; ratio: number; need: number; kind: string }[] = [];
    const seen = new Set<string>();
    const check = (el: Element, fgRaw: string, need: number, kind: string, text: string) => {
      const bgs = backdrops(el);
      const fg0 = parse(fgRaw);
      if (!fg0 || fg0[3] === 0) return;
      if (!bgs) { issues.push({ text, fg: hex(fg0), bg: "photo", ratio: 0, need, kind: "over image" }); return; }
      const o = opacity(el);
      let worst = { r: 99, fg: fg0, bg: bgs[0] };
      for (const bg of bgs) {
        const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg);
        const r = ratio(fg, bg);
        if (r < worst.r) worst = { r, fg, bg };
      }
      if (worst.r + 0.005 < need) {
        const key = `${kind}|${text}|${hex(worst.fg)}|${hex(worst.bg)}`;
        if (!seen.has(key)) { seen.add(key); issues.push({ text, fg: hex(worst.fg), bg: hex(worst.bg), ratio: Math.round(worst.r * 100) / 100, need, kind }); }
      }
    };

    // Text: every element with its own text.
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const own = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent ?? "").join("").trim();
      if (!own || !visible(el) || disabled(el)) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      check(el, cs.color, large ? 3 : 4.5, large ? "large text" : "text", own.slice(0, 50));
    }
    // Placeholders in fields.
    for (const el of Array.from(document.querySelectorAll("input[placeholder],textarea[placeholder]"))) {
      if (!visible(el) || (el as HTMLInputElement).value) continue;
      const ph = getComputedStyle(el, "::placeholder").color;
      const own = parse(getComputedStyle(el).backgroundColor);
      if (own && own[3] >= 1) {
        const p = parse(ph)!;
        const r = ratio(over(p, own), own);
        if (r < 4.5) issues.push({ text: `placeholder: ${el.getAttribute("placeholder")}`, fg: hex(over(p, own)), bg: hex(own), ratio: Math.round(r * 100) / 100, need: 4.5, kind: "placeholder" });
      } else check(el, ph, 4.5, "placeholder", `placeholder: ${el.getAttribute("placeholder")}`);
    }
    // Icons that carry meaning (inside buttons, links, tabs): 3:1.
    for (const svg of Array.from(document.querySelectorAll("svg"))) {
      if (svg.closest("[data-decorative]")) continue;
      if (!visible(svg) || disabled(svg) || svg.closest("[aria-hidden=true]") && !svg.closest("[role=button],[role=link],[role=tab],a,button")) continue;
      const shape = svg.querySelector("[stroke]:not([stroke=none]),[fill]:not([fill=none])") ?? svg;
      const cs = getComputedStyle(shape);
      const c = cs.stroke !== "none" ? cs.stroke : cs.fill;
      const label = svg.closest("[aria-label]")?.getAttribute("aria-label") ?? svg.closest("[role]")?.textContent?.trim().slice(0, 30) ?? "icon";
      check(svg, c, 3, "icon", `icon: ${label}`);
    }
    return issues;
  });
  return found.map((f) => ({ screen, ...f }));
}

export function formatIssues(issues: ContrastIssue[]) {
  return issues.map((i) => `${i.screen}  ${i.kind}  "${i.text}"  ${i.fg} on ${i.bg}  ${i.ratio} (needs ${i.need})`).join("\n");
}
