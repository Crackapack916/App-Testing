# CrackAPack

Daily live opening platform for Magic: The Gathering packs. Read `docs/CrackAPack_Business_Context.md` section 3 before changing anything in the order, queue, session or vault flow.

## Non negotiables
* Nothing is ever pre opened or cataloged before sale. No feature may create card data for a pack before `open_next_pack` runs on camera.
* The queue lock lives in Postgres (`packages/db/migrations/0005_queue.sql`), not in app code. App code calls the functions; it never writes `orders`, `queue_entries`, `batches`, `credit_entries`, `vault_entries` or `custody_events` directly.
* Staff never pick a customer or a pack. `open_next_pack` takes no customer or entry argument; keep it that way.
* Ledgers are append only. Balances are caches updated by triggers and guarded by CHECK constraints.
* Card data and prices come from MTGJSON. Vendor ids live only in `card_external_ids`.
* Business logic reads time from `app_now()`, never `now()`. The override works only in test mode.
* 1 credit = $0.01. Store money as integer credits or cents, never floats.

## Infrastructure
* Database: Neon project `calm-art-68010363` (us-west-2, Postgres 16). Connection string lives in `.env`, never committed.
* Payments: Stripe sandbox `acct_1UKC1BRkzwzDtkIa`, product `prod_VL0BnbAdob27Ft` "CrackAPack Credits". Bundles are prices with lookup keys `credits_900`, `credits_2550`, `credits_4950`, `credits_7200`, `credits_9300`, one per pack ladder tier; code references lookup keys, never price ids. Credits are sold through web checkout, not in app purchase.
* Processors plug in through `PaymentProcessor` in `packages/payments`. Webhooks go through `handleWebhook`, which writes only via `record_credit_purchase` and `refund_purchased_credits`.
* Mode is `test` until counsel clears the structure.
* Sell back (buyback) is off for the test run: `system_config.buyback_enabled` defaults to false and a trigger refuses any buyback request while it is off. Customers keep cards in the vault or ship them. Turn it on only when the resale side is built.
* Compliance mitigations in the database: 18+ age gate (`set_profile`, birthdate locked once verified), rolling 24 hour and 30 day spend caps with platform maximums (raising a limit waits 24 hours), and customer breaks that can't be shortened. Enforced by the `orders_spend_guard` trigger.
* Scheduled jobs (`packages/db/scripts/jobs.ts`, every 15 minutes via `.github/workflows/jobs.yml`): lock queues past their cutoff, release held buybacks.

* Card data: `packages/catalog` imports MTGJSON (AllPrintings, AllPricesToday) through `import_sets`, `import_cards` and `import_prices`. Cards match on (set, collector number) so internal ids never change. Price history is kept only for sets we sell and cards someone holds. Runs from `.github/workflows/mtgjson.yml` (needs the `NEON_DATABASE_URL` secret); this container cannot reach mtgjson.com.

* Sign in: Clerk. The API verifies Clerk session tokens locally with `CLERK_JWT_KEY` and links accounts through `upsert_auth_user`; staff are promoted with `set_user_role` (admin only). Apps fall back to pilot sign in when no Clerk key is set.
* Pack videos: one file per opened pack, uploaded from the staff browser straight to Vercel Blob (private) with a client token from `/staff/videos/token`; never through an API route. `VIDEO_DIR` (local disk) is for pilot runs and tests only and is refused in production. Customers watch through expiring signed links after `approve_and_notify_batch`. The old per order clips (`apps/api/src/clips.ts`, Mux) are kept only as custody data.
* Hosting: Vercel (`apps/api/src/index.ts` for the API, `apps/staff` as a static site). Every account and key is listed in `docs/SETUP.md`.

## Apps
* `apps/api`: Hono API. Customer routes at `/`, staff routes at `/staff` (staff role), processor webhooks at `/webhooks/:processor`. Database codes become HTTP responses only in `src/errors.ts`. `DEV_LOGIN=1` and `TEST_CLOCK=1` (X-Test-Now header) are pilot only: refused by a live database, and the server won't start with them when `CRACKAPACK_ENV=production` (not NODE_ENV, which Vercel always sets). Dev login grants staff only to emails in `DEV_STAFF_EMAILS`. Requests are capped at 256 KB.
* `apps/staff`: the nightly ops tool (Vite + React), served by the API at `/ops`. Keys: T/S/L/N/D/K/P switch screens (N = Videos: upload per pack, preview, approve and notify; D = Drops, set info, set limit overrides; K = Stock; P = Ship); Space cracks the next pack; B opens the next sealed box; V replaces a damaged pack; collector number + Enter logs a card (`f`/`e` suffix for foil/etched); Ctrl+Enter finalizes a pack.
* Card images come from Scryfall's CDN via `apps/api/src/images.ts` only; never copied or proxied. The public big pulls feed never shows customer names or prices.
* `apps/mobile`: the customer web app (Expo SDK 57, Expo Router, web export). Tabs: Drops, Search, Packs (raised center, default), Vault, Account; a top bar at 900px and wider. A red dot on Vault marks unseen cracked packs. `src/app/pack/[id].tsx` shows a pack's video and its cards in pulled order: no timed reveal, no sounds. One `Carousel` component serves Packs, Cracked today and Drops. Pin Expo package versions from `expo/bundledNativeModules.json` (the Expo version API is blocked here). Countdowns use server time from the API, never the device clock.
* Limits: 6 packs per set per customer for the whole test run (`system_config.max_packs_per_set_per_customer`), a drop's own limit or a logged staff override replaces it. A set with a published drop sells only while the drop is live.
* No push notifications anywhere: email plus the Vault dot.

## Commands
* `pnpm db:local` starts a local Postgres 16 and prints its URL (the session start hook runs this automatically on the web)
* `pnpm typecheck` typechecks every package
* `pnpm --filter @crackapack/db test` runs the database suite (migrations + invariants)
* `pnpm --filter @crackapack/payments test` runs the payments suite (needs the local Postgres)
* `pnpm --filter @crackapack/catalog test` runs the MTGJSON import suite against fixtures in MTGJSON's format
* `pnpm --filter @crackapack/api test` runs the API suite, including a full night over HTTP
* `pnpm --filter @crackapack/mobile test:e2e` exports the app for web and runs a customer's whole night in a phone sized browser
* `pnpm --filter @crackapack/staff test:e2e` runs the Playwright night in a real browser (`SCREENSHOTS=<dir>` saves the key screens)

## Conventions
* Follow `.claude/skills/db-change` for any schema or function change.
* Errors are raised as snake_case codes (`sold_out`, `cutoff_passed`) that the API maps to messages.
* Guard triggers use `app_flag()`, never a bare `current_setting()`; a NULL comparison silently passes a guard.
