# CrackAPack

Daily live opening platform for Magic: The Gathering packs. Read `docs/CrackAPack_Business_Context.md` section 3 before changing anything in the order, queue, session or vault flow.

## Non negotiables
* Nothing is ever pre opened or cataloged before sale. No feature may create card data for a pack before `open_next_pack` runs on camera.
* The queue lock lives in Postgres (`packages/db/migrations/0005_queue.sql`), not in app code. App code calls the functions; it never writes `orders`, `queue_entries`, `batches`, `credit_entries`, `vault_entries` or `custody_events` directly.
* Staff never pick a customer or a pack. `open_next_pack` takes no customer or entry argument; keep it that way.
* Ledgers are append only. Balances are caches updated by triggers and guarded by CHECK constraints.
* Card data and prices come from Scryfall's daily bulk file for the test run (behind `CardDataProvider`); MTGJSON is the planned source before launch. Vendor ids live only in `card_external_ids`.
* Business logic reads time from `app_now()`, never `now()`. The override works only in test mode.
* 1 credit = $0.01. Store money as integer credits or cents, never floats.

## Infrastructure
* Database: Neon project `calm-art-68010363` (us-west-2, Postgres 16). Connection string lives in `.env`, never committed.
* Payments: Stripe sandbox `acct_1UKC1BRkzwzDtkIa`, product `prod_VL0BnbAdob27Ft` "CrackAPack Credits". Bundles are prices with lookup keys `credits_1000`, `credits_2850`, `credits_5400`, one per pack ladder tier (1, 3, 6 packs); code references lookup keys, never price ids. Credits are sold through web checkout, not in app purchase.
* Processors plug in through `PaymentProcessor` in `packages/payments`. Webhooks go through `handleWebhook`, which writes only via `record_credit_purchase` and `refund_purchased_credits`.
* Mode is `test` until counsel clears the structure.
* Sell back (buyback) is off for the test run: `system_config.buyback_enabled` defaults to false and a trigger refuses any buyback request while it is off. Customers keep cards in the vault or ship them. Turn it on only when the resale side is built.
* Compliance mitigations in the database: 18+ age gate (`register_account`, `confirm_age`, birthdate encrypted and locked), optional daily, weekly and monthly spending limits on Pacific calendar windows (`set_spend_limit`; loosening waits `limit_loosen_delay_hours`, 0 by default), and breaks of 24 hours, 7 or 30 days that only staff can lift, with a reason. Enforced by the `orders_spend_guard` trigger.
* Scheduled jobs (`apps/api/scripts/jobs.ts`, every 15 minutes via `.github/workflows/jobs.yml`): lock queues past their cutoff, release held buybacks, send drop reminders and break ended emails.

* Card data: `packages/catalog` imports Scryfall bulk data daily (`.github/workflows/scryfall.yml`, needs `NEON_DATABASE_URL`) through `import_scryfall_sets` and `import_scryfall_cards`. Cards match on (set, collector number) so internal ids never change. Search runs on our own database; never call Scryfall per keystroke. This container cannot reach Scryfall or mtgjson.com.
* Guaranteed card data per set (business context section 15): a set can't go on sale, get a published drop, or take orders until `verify_set_card_data` confirms every printing from its own per set import (`importSetCardData`, `record_set_printings`) is in `cards` with an image. Staff run it from the Stock screen; the scryfall workflow runs it for every set on sale after the bulk job, whether or not the bulk job worked; the 15 minute jobs re-check and alert staff if a set stops passing.

* Sign in: our own email and password (`apps/api/src/routes/auth.ts`, scrypt hashes, HS256 tokens). Staff are promoted with `set_user_role` (admin only). An email is locked for 15 minutes after 10 wrong passwords (a reset ends it), and gets at most 3 reset emails an hour (`assert_login_allowed`, `create_password_reset`).
* Email: every customer and staff message goes through `EmailProvider` (`apps/api/src/email.ts`, templates in `email-templates.ts`), Gmail SMTP for the test run. The cracked email never names cards or values. Support address everywhere: crackapack.business@gmail.com.
* Pack videos: one file per opened pack, uploaded from the staff browser straight to Vercel Blob (private) with a client token from `/staff/videos/token`; never through an API route. `VIDEO_DIR` (local disk) is for pilot runs and tests only and is refused in production. Customers watch through expiring signed links after `approve_and_notify_batch`. The old per order clips (`apps/api/src/clips.ts`, Mux) are kept only as custody data.
* Hosting: Vercel (`apps/api/src/index.ts` for the API, `apps/staff` as a static site). Every account and key is listed in `docs/SETUP.md`.

## Apps
* `apps/api`: Hono API. Customer routes at `/`, staff routes at `/staff` (staff role), processor webhooks at `/webhooks/:processor`. Database codes become HTTP responses only in `src/errors.ts`. `DEV_LOGIN=1` and `TEST_CLOCK=1` (X-Test-Now header) are pilot only: refused by a live database, and the server won't start with them when `CRACKAPACK_ENV=production` (not NODE_ENV, which Vercel always sets). Dev login grants staff only to emails in `DEV_STAFF_EMAILS`. Requests are capped at 256 KB.
* `apps/staff`: the nightly ops tool (Vite + React), served by the API at `/ops`. Keys: T/S/L/N/D/K/P switch screens (S = Opening: crack packs in queue order; the first box starts the night and the last pack finishes it, with no session, stream or recording step; N = Videos: one phone video per pack, preview, approve and notify; D = Drops and set info; K = Stock; P = Ship); Space cracks the next pack; B opens the next sealed box; V replaces a damaged pack; collector number + Enter logs a card (`f`/`e` suffix for foil/etched); Ctrl+Enter finalizes a pack.
* Logo: `Logo` / `Wordmark` in `apps/mobile/src/components/Logo.tsx` and the `.brand` block in the staff site; source sheet `docs/brand/logo-sheet.webp`. Rules in `.claude/skills/brand`.
* Pack tiles are always the real product photo (`mtg_sets.pack_image_url`, set on the staff Stock screen): a set can't go on sale or get a published drop without one (0030). Foundations uses `apps/mobile/public/packs/fdn.jpg`.
* Card images come from Scryfall's CDN via `apps/api/src/images.ts` only; never copied or proxied. The public big pulls feed never shows customer names or prices.
* `apps/mobile`: the customer web app (Expo SDK 57, Expo Router, web export), styled to the brand kit (follow `.claude/skills/brand`). Tabs: Drops, Search, Packs (raised center, default), Vault, Account; a top bar at 900px and wider. A magenta dot on Vault marks unseen cracked packs. Cracked today opens `src/app/reel.tsx`, one pack per swipe, where the customer picks the filmed video or an animated reveal (`components/Reveal.tsx`) of the same logged cards in pulled order: the pack tears and the cards deal face down, a tap flips one card, Reveal all flips the rest one beat apart, press and hold zooms a face up card; no sound, no value callouts, same beat for every card. Shipping: the Vault's pinned Select cards to ship button, then pick cards, then `src/app/ship.tsx` (checkout: cards, address, fee in credits, confirm through `/me/shipments`). `src/app/pack/[id].tsx` (Watch) shows the video and the cards with prices; no best pull or value headline anywhere. One `Carousel` component serves Packs, Cracked today and Drops. Pin Expo package versions from `expo/bundledNativeModules.json` (the Expo version API is blocked here). Countdowns use server time from the API, never the device clock.
* Limits: at most 6 packs of each set per night's queue, across every customer (`system_config.max_packs_per_set_per_night`, enforced by `orders_set_guard` under a per night and set lock). No limit on any single customer. A set with a published drop sells only while the drop is live.
* No push notifications anywhere: email plus the Vault dot.

## Commands
* `pnpm db:local` starts a local Postgres 16 and prints its URL (the session start hook runs this automatically on the web)
* `pnpm typecheck` typechecks every package
* `pnpm --filter @crackapack/db test` runs the database suite (migrations + invariants)
* `pnpm --filter @crackapack/payments test` runs the payments suite (needs the local Postgres)
* `pnpm --filter @crackapack/catalog test` runs the Scryfall and MTGJSON import suite against real fixtures
* `pnpm --filter @crackapack/api test` runs the API suite, including a full night over HTTP
* `pnpm --filter @crackapack/mobile test:e2e` exports the app for web and runs a customer's whole night in a phone sized browser
* `pnpm --filter @crackapack/staff test:e2e` runs the Playwright night in a real browser (`SCREENSHOTS=<dir>` saves the key screens)

## Conventions
* Follow `.claude/skills/db-change` for any schema or function change.
* Errors are raised as snake_case codes (`sold_out`, `cutoff_passed`) that the API maps to messages.
* Guard triggers use `app_flag()`, never a bare `current_setting()`; a NULL comparison silently passes a guard.
