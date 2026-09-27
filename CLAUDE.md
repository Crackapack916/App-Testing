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

* Card data: `packages/catalog` imports MTGJSON (AllPrintings, AllPricesToday) through `import_sets`, `import_cards` and `import_prices`. Cards match on (set, collector number) so internal ids never change. Price history is kept only for sets we sell and cards someone holds. Runs from `.github/workflows/mtgjson.yml` (needs the `NEON_DATABASE_URL` secret); this container cannot reach mtgjson.com.

## Apps
* `apps/api`: Hono API. Customer routes at `/`, staff routes at `/staff` (staff role), processor webhooks at `/webhooks/:processor`. Database codes become HTTP responses only in `src/errors.ts`. `DEV_LOGIN=1` and `TEST_CLOCK=1` (X-Test-Now header) are pilot only and refused by a live database.
* `apps/staff`: the nightly ops tool (Vite + React), served by the API at `/ops`. Keys: T/S/L/N switch screens; Space cracks the next pack; B opens the next sealed box; V voids; collector number + Enter logs a card (`f`/`e` suffix for foil/etched); Ctrl+Enter finalizes a pack.
* Clips: an order's clip runs from 2s before its first pack to when the next order's first pack is opened (or the session ends). Pilot clips are media fragments into the session recording (`<stream>#t=start,end`).

## Commands
* `pnpm db:local` starts a local Postgres 16 and prints its URL (the session start hook runs this automatically on the web)
* `pnpm typecheck` typechecks every package
* `pnpm --filter @crackapack/db test` runs the database suite (migrations + invariants)
* `pnpm --filter @crackapack/payments test` runs the payments suite (needs the local Postgres)
* `pnpm --filter @crackapack/catalog test` runs the MTGJSON import suite against fixtures in MTGJSON's format
* `pnpm --filter @crackapack/api test` runs the API suite, including a full night over HTTP
* `pnpm --filter @crackapack/staff test:e2e` runs the Playwright night in a real browser (`SCREENSHOTS=<dir>` saves the key screens)

## Conventions
* Follow `.claude/skills/db-change` for any schema or function change.
* Errors are raised as snake_case codes (`sold_out`, `cutoff_passed`) that the API maps to messages.
* Guard triggers use `app_flag()`, never a bare `current_setting()`; a NULL comparison silently passes a guard.
