/**
 * Every customer and staff email (brief item 15), each as HTML and plain text.
 * Plain, short copy. The "cracked" email never names cards or shows values.
 * Drop reminders are commercial: they carry the mailing address and an unsubscribe link.
 */
import type { EmailKind, EmailMessage } from "./email";

export const SUPPORT_EMAIL = "crackapack.business@gmail.com";
/** Set MAILING_ADDRESS in the hosting environment once Tyson chooses one (a PO box is fine). */
export const ADDRESS_PLACEHOLDER = "[Mailing address to come]";

export type Rendered = { subject: string; text: string; html: string };
export type RenderContext = { appUrl: string; mailingAddress?: string | null };

type D = Record<string, any>;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const credits = (n: number) => Number(n ?? 0).toLocaleString("en-US");
export const pacific = (t: string | Date) => new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A paragraph, a button, or a small note. The same list becomes both the HTML and the text. */
type Block = { p: string } | { button: string; href: string } | { note: string };
type Body = { subject: string; heading: string; blocks: Block[]; commercial?: { unsubscribe: string } };

const PERIOD: Record<string, string> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

const templates: Record<EmailKind, (d: D, c: RenderContext) => Body> = {
  order_confirmation: (d, c) => ({
    subject: `Order confirmed: ${plural(d.packs, "pack")} of ${d.set_name}`,
    heading: "Your order is in tonight's queue",
    blocks: [
      { p: `${plural(d.packs, "sealed pack")} of ${d.set_name} for ${credits(d.credits)} credits.` },
      { p: `The queue locks at 7:00 PM PT. Then we open every pack in queue order, film each one, and email you when your cards and video are in your Vault.` },
      { p: `You can cancel for a full credit refund until 7:00 PM PT from Account.` },
      { button: "See your order", href: `${c.appUrl}/account` },
    ],
  }),
  pack_cracked: (d, c) => ({
    subject: "You just cracked a pack",
    heading: "You just cracked a pack",
    blocks: [
      { p: `Your ${plural(d.packs, "pack")} of ${d.set_name} ${d.packs === 1 ? "was" : "were"} opened on camera tonight. The video and the cards are in your Vault.` },
      { button: "Open your Vault", href: d.url ?? `${c.appUrl}/vault` },
    ],
  }),
  shipping_confirmation: (d, c) => ({
    subject: "Your cards shipped",
    heading: "Your cards are on the way",
    blocks: [
      { p: `${plural(d.cards, "card")} shipped${d.carrier ? ` with ${d.carrier}` : ""}.` },
      { p: `Tracking number: ${d.tracking}` },
      { button: "See your Vault", href: `${c.appUrl}/vault` },
    ],
  }),
  sellback_receipt: (d, c) => ({
    subject: `Sell back receipt: ${credits(d.credits)} credits`,
    heading: "Sell back receipt",
    blocks: [
      { p: `You sold back ${plural(d.cards, "card")} for ${credits(d.credits)} credits.` },
      ...(d.hold_until ? [{ p: `The credits will be added by ${pacific(d.hold_until)}.` }] : [{ p: "The credits are in your account now." }]),
      { note: "Credits can be used on CrackAPack packs. 100 credits = $1. They can't be cashed out or sent to anyone." },
      { button: "See your activity", href: `${c.appUrl}/account` },
    ],
  }),
  limit_changed: (d, c) => ({
    subject: "Your spending limit changed",
    heading: "Your spending limit changed",
    blocks: [
      { p: d.credits == null
        ? `Your ${PERIOD[d.period]} limit ${d.pending ? "will be removed" : "was removed"}.`
        : `Your ${PERIOD[d.period]} limit ${d.pending ? "will change" : "is now"}${d.pending ? " to" : ""} ${credits(d.credits)} credits.` },
      ...(d.pending && d.at ? [{ p: `This takes effect ${pacific(d.at)}.` }] : []),
      { note: `If you didn't make this change, reply to this email or write to ${SUPPORT_EMAIL}.` },
      { button: "Spending settings", href: `${c.appUrl}/account` },
    ],
  }),
  break_started: (d, c) => ({
    subject: "Your break has started",
    heading: "Your break has started",
    blocks: [
      { p: `You can't buy packs or add credits until ${pacific(d.until)}.` },
      { p: "You can still see your Vault, watch your videos and ship your cards." },
      { note: `A break can't be shortened from the site. To ask for an early end, write to ${SUPPORT_EMAIL}.` },
      { button: "Account", href: `${c.appUrl}/account` },
    ],
  }),
  break_ended: (d, c) => ({
    subject: "Your break has ended",
    heading: "Your break has ended",
    blocks: [
      { p: d.lifted ? "We ended your break early, as you asked." : "Your break is over." },
      { p: "Your spending limits are still in place. You can change them in Account." },
      { button: "Spending settings", href: `${c.appUrl}/account` },
    ],
  }),
  drop_reminder: (d, c) => ({
    subject: `${d.set_name} goes live on CrackAPack at ${pacific(d.starts_at).replace(/^\w+, /, "")}`,
    heading: `${d.set_name} goes live in an hour`,
    blocks: [
      { p: `This is when the set goes live on CrackAPack: ${pacific(d.starts_at)}.` },
      { button: "See drops", href: `${c.appUrl}/drops` },
      { note: "You asked for this reminder. It's the only one we'll send for this drop." },
    ],
    commercial: { unsubscribe: d.unsubscribe_url },
  }),
  password_reset: (d) => ({
    subject: "Reset your CrackAPack password",
    heading: "Reset your password",
    blocks: [
      { p: "Use this link to choose a new password. It works once and expires in one hour." },
      { button: "Choose a new password", href: d.link },
      { note: "If you didn't ask for this, you can ignore this email. Your password hasn't changed." },
    ],
  }),
  staff_alert: (d, c) => ({
    subject: `CrackAPack ops: ${d.title}`,
    heading: d.title,
    blocks: [{ p: d.body }, { button: "Open the ops site", href: `${c.appUrl}/ops/` }],
  }),
};

export function renderEmail(m: EmailMessage, c: RenderContext): Rendered {
  const b = templates[m.kind](m.data, c);
  const address = c.mailingAddress?.trim() || ADDRESS_PLACEHOLDER;
  const footerText = [
    `Questions or a problem: ${SUPPORT_EMAIL}`,
    "CrackAPack is an unofficial retailer, not produced by or endorsed by Wizards of the Coast.",
    ...(b.commercial ? [`CrackAPack, ${address}`, `Unsubscribe from this reminder: ${b.commercial.unsubscribe}`] : []),
  ];
  const text = [b.heading, "", ...b.blocks.flatMap((x) =>
    "p" in x ? [x.p, ""] : "button" in x ? [`${x.button}: ${x.href}`, ""] : [x.note, ""]), "--", ...footerText].join("\n");

  const block = (x: Block) => "p" in x
    ? `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#252329">${esc(x.p)}</p>`
    : "button" in x
      ? `<p style="margin:6px 0 18px"><a href="${esc(x.href)}" style="display:inline-block;background:#3E5170;color:#FCFCFC;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:12px 20px;border-radius:8px">${esc(x.button)}</a></p>`
      : `<p style="margin:0 0 14px;font-size:13px;line-height:19px;color:#47434D">${esc(x.note)}</p>`;
  const footerHtml = footerText.map((l) => l.startsWith("Unsubscribe")
    ? `<a href="${esc(b.commercial!.unsubscribe)}" style="color:#3E5170">Unsubscribe from this reminder</a>`
    : esc(l)).join("<br>");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.subject)}</title></head>
<body style="margin:0;background:#D9DFE9;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#D9DFE9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FCFCFC;border:1px solid #D3D3D8;border-radius:10px">
<tr><td style="padding:22px 24px 8px;font-family:Georgia,serif;font-size:20px;font-weight:700;color:#0A101A;border-bottom:3px solid #87CFEF">CrackAPack</td></tr>
<tr><td style="padding:20px 24px 8px"><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;line-height:28px;color:#252329">${esc(b.heading)}</h1>
${b.blocks.map(block).join("\n")}</td></tr>
<tr><td style="padding:14px 24px 20px;font-size:12px;line-height:18px;color:#47434D;border-top:1px solid #D3D3D8">${footerHtml}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: b.subject, text, html };
}
