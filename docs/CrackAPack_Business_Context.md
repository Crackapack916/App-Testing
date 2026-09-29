# CrackAPack: Full Business Context

This document exists so you have the complete plan before writing any code. It reflects real research on sourcing, legal risk, unit economics, and financing, not assumptions. Read this in full before proposing architecture.

**The single most important thing in this document is section 3.** The original concept involved pre-opening and cataloging packs before sale. That structure is the same one currently facing a wave of gambling lawsuits industry-wide. The plan has since moved to a same-day live-opening structure instead, which is meaningfully safer. Build to that structure, not the older one.

---

## 1. What the business is

An online store that sells Magic: The Gathering booster packs with a filmed, same-day reveal. A customer buys a pack of a specific set, nothing is opened or known in advance, their specific physical pack is opened live on camera later that day, and they get notified with their own clip. From there they choose per card whether to keep it in a free vault, sell it back for store credit, or have it shipped.

Revenue comes from the spread between what a pack costs from a booster box and what a customer pays for the experience of ripping it with a guaranteed buyback attached.

## 2. Locked design decisions

| Decision | Choice | Why |
|---|---|---|
| Product | Play boosters first, collector boosters later | Lower capital, lower buyback risk, bigger audience |
| Inventory | **Never pre-opened or cataloged.** Sealed until a customer's order triggers it | This is the core legal fix, see section 3 |
| Opening cadence | Daily batch. Orders placed before a 7pm cutoff are opened live on camera between 7 and 8pm, customer notified by 9pm | Keeps labor to one nightly session instead of per-order live opening, while still opening nothing before it's paid for |
| Assignment | Strict first-come order queue, locked before the camera starts. Never chosen after contents are seen | This is what makes it fair, not a hash or a published pool over known contents |
| Buyback | Store credit only, non-withdrawable, buylist schedule | Weakens the prize element, beats cash by $0.30 to $0.50 a pack |
| Fulfillment | Free vault, ship on request | The single biggest profit lever in the model |
| Release model | Own release windows, not tied to real-world prerelease day | A set can only be sold once enough sealed stock is sourced. Older sets stay available continuously alongside whatever is newest |
| Accessories | Checkout add-on only, never a storefront | 15% gross on an item that costs $7.61 to ship alone |
| Bulk commons | Giveaway filler, eBay lots, individual listing above $0.25 | Monetizes a waste stream |

## 3. The legal structure, read this before building anything

### Why the original pre-opened model was the wrong one

Pre-opening and cataloging packs before selling access to them is the exact structure currently facing an active, expanding wave of gambling lawsuits against comparable platforms (Whatnot, Collector Crypt, Courtyard.io, all named in coverage from August 2026). The legal test for an unlicensed lottery is payment, chance, and a prize, and "prize" is satisfied by anything of value, not just cash, which is why non-withdrawable store credit reduces that risk without eliminating it. A pool of already-known-value items sitting cataloged before a sale is the fact pattern regulators and plaintiffs are targeting right now, regardless of how the assignment within that pool is randomized.

A sweepstakes-style workaround (dual currency plus a free alternative method of entry, the mechanism that lets sites like Chumba and Stake.us legally operate) was considered and ruled out. California passed AB 831, effective January 1, 2026, banning that exact model in-state by name. It is also collapsing nationally: at least 17 states have banned or restricted it in 2026, six operators have shut down since October 2025, and more than 100 class actions are active. It is not a stable foundation anywhere, and it is flatly unavailable for a Sacramento-based operator.

### The structure actually being built instead

1. Customer buys a pack of a specific set. Nothing about that pack's contents exists yet, nothing has been opened, sorted, or cataloged.
2. Orders placed before a daily 7pm cutoff go into a queue, in strict timestamp order. **This queue is locked before any pack in that day's batch is opened.** No human ever chooses which physical pack goes to which customer after seeing what's inside one.
3. Between 7 and 8pm, staff opens that day's sealed packs on camera, pulling them in physical order straight from an unopened case, matched one-to-one against the pre-locked order queue.
4. By 9pm, each customer gets a notification, their specific clip from that session, and can watch it or just check their vault directly.
5. From there: sell back for credit, ship, or leave it in the vault.

**Why this is meaningfully safer.** The customer is paying for a pack of a known product line, not for a specific already-known-value item pulled from a curated pool. Nothing is cataloged or known before payment is committed. The order-to-pack matching is fixed before contents exist, which removes the ability for anyone, intentionally or not, to steer a specific pull to a specific person.

**Why this is not risk-free, and needs a real legal opinion before real launch.** This is functionally a live box break on a daily timer instead of an instant one. Live box breaks are an existing, long-running hobby practice, and this specific structure has not been declared clean by any court or regulator, it sits closer to the legitimate side of the line than the original plan, not outside the question entirely. Filming builds customer trust and proves nothing was swapped, but it does not change the underlying legal test. Treat the legal opinion (see section 10) as necessary before scaling real volume, not optional.

**What this costs operationally that the original plan did not.** This requires a real staffed session every single day orders come in, roughly a one to two hour window in the evening, not a set-and-forget backend. That labor cost needs to be budgeted for explicitly, see section 4.

## 4. Unit economics

### All-in cost per pack

| Line | Amount | Basis |
|---|---|---|
| Pack | $4.17 | Settled-set box at $125 / 30 packs |
| Live opening and filming labor | $0.45 | Based on a 36-packs-per-hour handling rate, now concentrated into the nightly session rather than spread across the day |
| Vault | $0.22 | Box, sleeve, filing, retrieval |
| Net buyback | $0.18 | Paid out less resale recovery |
| Shipping share | $1.02 | One box per 8 packs at $8.16 |
| **Total** | **$6.04** | |

A local shop sells that same pack for $6.95. The whole working envelope is $0.91 before any premium.

### Pricing ladder

| Tier | Price | Per pack | Profit/order | Margin |
|---|---|---|---|---|
| 1 pack | $9.00 | $9.00 | $2.39 | 26.6% |
| 3 packs | $25.50 | $8.50 | $6.32 | 24.8% |
| 6 packs | $49.50 | $8.25 | $11.49 | 23.2% |
| 9 packs | $72.00 | $8.00 | $15.21 | 21.1% |
| 12 packs | $93.00 | $7.75 | $17.47 | 18.8% |

Blended: $1.85 profit per pack, $35.67 average order, 22.5% margin. Hard floor on a 12-pack is $75. Never price below $90 at standard sourcing.

### The three levers that actually matter

| Lever | Range | Effect on profit per pack |
|---|---|---|
| Vault depth | 2 to 20 packs per shipment | -$0.22 to $3.45 |
| Box price | $140 to $90 | $2.35 to $3.99 |
| Shipping charge below threshold | free to $7.99 | $2.84 to $3.81 |

Order size barely matters. Do not build bundle upsells as the main lever, build vault stickiness instead.

## 5. Sourcing

No distributor wholesale account for year one, assume retail box buying only. A set can only go on sale once enough sealed boxes are actually in hand, since nothing can be pre-opened to buffer demand anymore. If a set sells out of sealed stock for a given day, it goes temporarily unavailable for new orders rather than pulling from a pre-opened reserve.

### Verified box pricing

| Set | Box price | Per pack |
|---|---|---|
| Marvel Spider-Man | $114 | $3.80 |
| Foundations (post-drop) | $120-130 | $4.00-4.33 |
| Lorwyn Eclipsed | $128.50 | $4.28 |
| Edge of Eternities | $139.99 | $4.67 |
| Opportunistic Amazon/eBay | under $90 | under $3.00 |

Buying at launch costs more than half the margin. The week 8-12 correction window after a set's release is where the real margin lives, so a newly released set may only become available here once sourcing reaches that window, older sets stay available continuously in the meantime.

## 6. Fulfillment and the vault

Vaulting costs about $0.22 a pack. Shipping a single pack alone costs about $8.16, since USPS eliminated tiered pricing under one pound in 2026. Storage is roughly 37 times cheaper than shipping alone, which is why free vault storage is standard in this category.

- No storage fee, ever.
- Free shipping above a threshold that maps to 8-12 packs. $4.99 below it.
- Written inactivity policy before the first sale: after 12 months with no activity, two emails, then ship at customer expense or convert to store credit at buylist value.
- Cards of the same printing and condition are fungible. Keep one sorted inventory plus a per-customer ledger in the database, and pull matching copies at ship-out. Hold the specific physical card only for foils, serialized cards, and anything over roughly $20 where condition and provenance genuinely matter. **Design the database around this from day one.**

## 7. Buyback and credit

- Store credit only, non-withdrawable. Credit buys packs, it does not convert to cash.
- Buylist schedule: 90% of market on cards $2 and up, 50% on $0.50 to $2, a flat two cents below that.
- Large payouts get a stated processing window, not an instant credit, to protect cash flow.
- Hold a buyback reserve of roughly 10% of monthly pack revenue.

## 8. Technology requirements

This is not a catalog store, and it is not a pre-opened repack store either. It needs:

- **An order queue that locks before any pack is opened.** Every order placed before the daily 7pm cutoff gets a fixed position in that day's sequence, timestamped, immutable, before staff ever touches a sealed case. This is the core trust and legal mechanism, treat it as such.
- **A live filming and clipping pipeline.** Staff opens sealed packs on camera in strict physical order from an unopened case, matched one-to-one against the locked queue. The system needs to record the full session, then automatically or semi-automatically clip each customer's specific segment for their notification.
- **Push notifications.** "You just cracked a pack" by 9pm, linking to the clip and the vault.
- **Per-customer vault ledger against a fungible inventory**, as described in section 6.
- **Buyback engine on a live, editable buylist schedule.**
- **Non-withdrawable credit ledger.**
- **Shipment batching and label generation.**
- **Chain-of-custody logging**, timestamp the queue lock, timestamp the case being opened, timestamp each clip, so the sequence can be reconstructed and shown to a regulator or a skeptical customer if it's ever questioned.

### Card data source, this matters

**Do not build production pricing or the card database on Scryfall.** Scryfall's terms state their data is for Magic software and community content under the Fan Content Policy, that access may not be paywalled, and that the data may not be repackaged or proxied to other consumers. Selling packs where card data and pricing are core to a paid product runs against those terms.

**Use MTGJSON instead for production.** It is MIT licensed, explicitly permits commercial use and resale, includes pricing, and rebuilds daily. Scryfall is fine for prototyping only, kept behind an adapter so it can be swapped out cleanly.

Keep an internal card record so no vendor's fields or URLs touch the database directly:

```
card { internal_id, name, set_code, collector_number,
       rarity, finish, condition,
       image_url      <- own photo, own storage
       market_price, price_source, price_asof }
```

Cache locally rather than calling any pricing source live. Card images should be original photography, not scraped art.

### Platform decision

Shopify is the wrong platform. Shopify Payments prohibits "gambling products and services, such as sports forecasting, lotteries, bidding, contests, or sweepstakes," and this category sits close to that line even under the safer structure. Shopify Basic also charges an extra 2% for third-party payment gateways, which stacks badly on a high-risk processing rate. Build custom.

### Payments

Standard processors run 2.9% plus $0.30 but carry real risk of account closure if the model gets reclassified. A high-risk processor runs 2.9% to 9% by vertical plus a 5-15% rolling reserve that tapers with history. Disclose the actual model to whichever processor is chosen up front, misrepresentation is what causes freezes, not what prevents them.

## 9. Legal and compliance

See section 3 for the core structural reasoning. What still applies regardless of structure:

| Measure | Value |
|---|---|
| Store credit only, non-withdrawable | Real, weakens the prize element |
| Order queue locked before contents are known | Real, this is the core fix over the original plan |
| Filmed, chain-of-custody opening | Credibility and trust, not a legal shield on its own |
| No advertised chase card | Real, keeps the business outside California Penal Code 319.3's grab-bag pattern (which is narrowly written to cover sports trading cards specifically, but the general lottery test still applies regardless of category) |
| Age gate and spending limits | Real, standard mitigation |
| Never reseal a pack | Real, ship contents directly, never a resealed pack |

A California gambling law opinion, specifically on this live daily-batch structure, is treated as a required stage before real volume, not an optional nicety. Budget $1,500 to $5,000.

### Setup costs, Sacramento

Seller's permit and EIN are free. Fictitious business name is about $60. Sacramento Business Operations Tax is unconfirmed, budget $100. LLC filing is $70 one time, plus the $800 California LLC annual franchise tax every year. Sole proprietor with a DBA is about $160 plus the city fee. LLC is about $990 year one, $800 every year after.

## 10. Startup capital and stage plan

| Stage | Spend | What happens | Gate to pass |
|---|---|---|---|
| 1. Demand check | $0 | Post the concept, build a list, rip packs on video from boxes bought anyway | 100 signups or 25 people saying they would pay |
| 2. Manual pilot | $995 | 3 boxes, sold on Whatnot or similar, seller's permit filed | 40 packs sold in 60 days at $8-9 |
| 3. Volume on borrowed rails | reinvest | Scale to 200-300 packs/month, buyback handled manually | 250 packs/month for two straight months |
| 4. Legal opinion | $2,500 | Opinion specifically on the daily live-opening, queue-locked structure | Counsel clears the structure |
| 5. Build and launch | $12,000-35,000 | Custom site, LLC, processor, domain, first real inventory | Live |

### Financing reality

SBA loans exclude gambling businesses when gambling is the primary activity, and the test is primary purpose, not a percentage of revenue. SBA microloans through a CDFI are the only realistic institutional path, up to $50,000, average around $13,000, 8-13% rate, no federal minimum credit score, but still SBA-backed underneath, so the same eligibility test applies.

**No institutional lender funds stages 1 through 4.** Those stages cost $3,495 combined. A loan in the neighborhood of $5,000 covers the manual pilot and part of the legal opinion, it does not reach a live platform. Outside capital only really makes sense at stage 5.

## 11. Financial projections

Blended ladder at $1.85 profit per pack, $35.67 average order. Year 1 fixed overhead $381/month, growing 25% per year.

| Scenario | Year | Packs/mo | Revenue | Gross profit | Net | Hours/week |
|---|---|---|---|---|---|---|
| Conservative | 1 | 120 | $11,808 | $2,661 | -$1,907 | 1.4 |
| Conservative | 2 | 300 | $29,520 | $6,653 | $943 | 3.4 |
| Base | 1 | 250 | $24,600 | $5,544 | $976 | 2.8 |
| Base | 2 | 700 | $68,880 | $15,524 | $9,814 | 7.9 |
| Base | 3 | 1,400 | $137,760 | $31,048 | $24,196 | 15.8 |
| Upside | 3 | 2,600 | $255,840 | $57,661 | $50,809 | 29.4 |

Break-even is roughly 206-232 packs a month, about seven boxes. Note the hours/week figures were modeled on spread-out scanning labor, the nightly filming session concentrates that time into an evening window rather than spreading it out, budget for a fixed nightly time block on top of these hours regardless of volume, since the session has to happen daily whether 5 or 50 orders came in.

## 12. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Gambling reclassification | High, but reduced under the live-opening structure | Legal opinion on this specific structure before scaling, credit-only buyback, no advertised chase card, age gate, geofence strict states |
| Payment processor closure | High | Disclose the model up front, high-risk processor from day one, hold reserve, keep a backup processor onboarded |
| Sourcing cost drift | Medium | Buy in the week 8-12 correction window, never at launch premium |
| Nightly labor commitment | Medium, new under this structure | This is now a real daily staffed obligation, not set-and-forget, budget and staff accordingly |
| Vault liability and abandonment | Medium | Written inactivity policy before first sale |
| Card image copyright | Low | Own photography from day one |
| Competitor response | Medium | Compete on Magic-native framing and honest pricing on older sets |
| Multi-state sales tax nexus | Low | Sales tax software once volume warrants |

## 13. What the app needs to reflect

**Customer facing, bottom tab navigation:**
1. Packs, center tab, default landing. Browse sets currently available for order, price in credits. Buying here places an order into the queue, it does not trigger an instant rip.
2. Vault. Cards pulled but not yet shipped or sold back, live market value shown per card.
3. Search. Card lookup similar to ManaBox, powered by MTGJSON.
4. Account. Credit balance, order history, shipping requests, and a place to see "cracked tonight" notifications and clips.

**Internal staff tool, this is not optional:**
A same-day operations view: the locked order queue for that evening, a way to start and manage the filmed opening session against that queue in strict order, and a clipping and notification trigger once a pack is opened and matched. This tool is used every single day orders exist, design it for a fast, low-friction nightly session, since this labor cost repeats daily regardless of volume.

## 14. Resale and inventory recovery

This section covers what happens after a customer sells a card back. Buyback is an ownership change, not a shipment. The card is already physically in our vault, so it moves from the customer's ledger to house inventory. The business then recovers value by reselling it.

### Channel costs (verify before building, fees change)

| Channel | Cost to sell | Notes |
|---|---|---|
| TCGplayer marketplace | 10.75% commission plus 2.5% plus $0.30 per order, about 13% to 14% of a typical order | New sellers are capped at 100 active listings until Level 4 (51 fulfilled orders, 90% feedback). W-9 required. No new official API access is being granted, so use CSV bulk listing in the Seller Portal |
| eBay | 13.25% final value fee on trading cards, no separate processing fee | Official Sell Inventory API exists. Good for bulk lots and higher value singles |
| Buylists (Card Kingdom and similar) | Pay a fraction of retail, often 40% to 70% in credit and 25% to 50% in cash | No listing labor. Card Kingdom accepts a CSV. Best for bulk and slow cards |
| Our own site (phase 2, off by default) | No channel fee | Customers spend credit on singles from house stock. Recycles credit at no fee |

### Cheap cards
The flat $0.30 and postage eat cheap cards. One estimate has about 40% of a cheap card's value gone once postage is paid. Below roughly $0.25 a card goes to bulk (lots, giveaway filler, buylist bulk). Between $0.25 and $2, sell in multi card orders so the flat fee is shared.

### Credit accounting
Buyback pays in credit at face value, but the real cost of that credit is what the customer buys with it. If credit is spent on packs, its cost is about pack cost divided by pack price, roughly 40% to 60% depending on box price and ladder tier. Track both credit_issued (face value) and estimated_cost_basis. Judge resale against cost basis, and also report it against face value, because unspent credit changes the picture.

Example: a $5 card bought back at 90% is $4.50 of credit. Resold on TCGplayer it nets about $4.03 before postage. Against face value that is a $0.47 loss. Against a cost basis near $2.50 it is about a $1.50 gain. The model only works if credit really gets recycled into packs.

### Rules
- Never reseal packs and never build mystery bundles from house inventory. Bulk giveaway filler only: cards under $0.25 each, labeled as bulk, no rares or foils.
- Physical count invariant: physical cards on the shelf must equal customer vault ledger plus house stock plus in transit. Reconcile it regularly.
- Sales tax: marketplaces collect and remit on their own sales, but we still need our own seller's permit and collect on sales through our own site.

## 15. Card data must be guaranteed for every offered set, not just hoped for

The daily bulk import (every Magic printing, roughly 90,000+ rows) is the main way card data and images reach the database. That job can fail, run late, or partially complete, see the scryfall workflow failure on 2026-09-28 ("Failed to parse URL from undefined") for a real example.

A failed or incomplete daily import must never be able to produce a blank card in a customer's Vault. Every set currently sold as a pack needs its own guaranteed, checked import path, separate from and more reliable than the big daily job:

- A per-set import (or verification pass) runs whenever a new set is added to the Packs page, and again before any wave for that set goes live.
- Before a set can go live for purchase, the system confirms every printing in that set exists in the database with a valid image URL. If it doesn't, the set stays unavailable and this is surfaced to staff, not discovered later by a customer with a blank Vault card.
- This check runs independently of whether the full daily bulk import happened to succeed that day.
