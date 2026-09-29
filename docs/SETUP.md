# CrackAPack setup runbook

Everything that needs an account or a secret, and where each value goes. Secrets never go in the repo, in chat, or in any file: use the GitHub or Vercel secret stores named below.

Status key: **you** = needs your account or approval, **Claude** = can be done from a session once the keys exist.

## 1. GitHub (you)

| Step | Where |
|---|---|
| Merge `claude/crackapack-mobile-app-hq1y9g` into the default branch | GitHub pull request |
| Secret `NEON_DATABASE_URL`: the Neon **direct** string for the `preview` branch | Repo, Settings, Secrets and variables, Actions |
| Secret `GMAIL_APP_PASSWORD` (step 3) | Same place |
| Variable `MAILING_ADDRESS` (step 3) | Same place, Variables tab |
| Run **scryfall** once (it then runs daily) | Repo, Actions, scryfall, Run workflow |

Before a set can go on sale, its card data must pass a check (every printing present with an image), and it needs its real pack photo (staff Stock screen, Pack photo URL). Press **Import and check** on the staff Stock screen, or run **scryfall** with the set code. The daily run re-imports and checks every set on sale.

The **jobs** workflow runs every 15 minutes: locks queues at 7:00 PM PT, releases held sell backs, and sends drop reminders and break ended emails. It skips quietly until `NEON_DATABASE_URL` exists.

## 2. Stripe: credits (you)

| Step | Where |
|---|---|
| Copy the sandbox secret key (`sk_test_...`) | Stripe dashboard, Developers, API keys |
| Add a webhook to `https://<site>/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` | Developers, Webhooks |

Bundles are prices on product `prod_VL0BnbAdob27Ft` with lookup keys `credits_1000`, `credits_2850`, `credits_5400` (1, 3 and 6 packs on the working ladder). Code uses lookup keys, never price ids.

| Value | Goes to (Vercel) |
|---|---|
| Secret key | `STRIPE_SECRET_KEY` |
| Webhook signing secret | `STRIPE_WEBHOOK_SECRET` |
| `false` until live | `STRIPE_LIVEMODE` |

## 3. Email: crackapack.business@gmail.com (you)

| Step | Where |
|---|---|
| Turn on 2 Step Verification | myaccount.google.com, Security |
| Create an app password named CrackAPack | myaccount.google.com, Security, App passwords |
| Enter it yourself as `GMAIL_APP_PASSWORD` | Vercel env and the GitHub secret (step 1) |
| Choose the mailing address for email footers (a PO box is fine) and enter it as `MAILING_ADDRESS` | Vercel env and the GitHub variable (step 1) |

Until the app password exists, emails are printed to the logs instead of sent. Gmail allows about 500 recipients a day from a personal account. Once there is a business domain, swap the `EmailProvider` in `apps/api/src/email.ts` for Resend, Postmark or SES.

## 4. Video storage: Vercel Blob (you)

| Step | Where |
|---|---|
| Create a Blob store (private) and connect it to `crackapack-preview` | Vercel, Storage, Create, Blob |

Connecting it adds `BLOB_READ_WRITE_TOKEN`. Staff browsers upload each pack video straight to it; customers watch through links that expire after an hour. Retention is 12 months (`system_config.video_retention_months`), pending counsel.

## 5. Private test site (Claude)

One Vercel project, `crackapack-preview`, built by `scripts/build-preview.mjs`: the customer site at `/`, the staff site at `/ops/`, the API at `/api`. Deployment protection keeps it visible only to the Vercel account owner. The build applies every migration first.

| Env (Vercel) | Value |
|---|---|
| `DATABASE_URL` | Neon branch `preview`, **pooled** string |
| `JWT_SECRET` | random 32+ chars |
| `DOB_ENCRYPTION_KEY` | 32 random bytes, base64 |
| `APP_URL` | `https://crackapack-preview.vercel.app` |
| `CRACKAPACK_ENV` | `preview` (`production` refuses the pilot switches below) |
| `DEV_LOGIN`, `TEST_CLOCK` | `1` (pilot only) |
| `DEV_STAFF_EMAILS` | `staff@crackapack.test` |
| `PG_POOL_MAX` | `3` |
| `STRIPE_*`, `GMAIL_APP_PASSWORD`, `MAILING_ADDRESS`, `BLOB_READ_WRITE_TOKEN` | steps 2 to 4 |

`VIDEO_DIR` (local disk video storage) is for local runs and tests only; production refuses it.

**Staff account:** sign up on the site, then promote the account in the Neon SQL editor: `select set_user_role('<email>', 'admin', null);`

## 6. What only you can supply

* Names and set codes of the two test sets, and each set's official pack photo URL (staff Stock screen; Foundations already has one) and Wizards "What's in a pack" link (staff site, Drops, Set info).
* Drop dates and times (staff site, Drops).
* Confirmation of the pack ladder (1 pack 1,000 credits, 3 at 950, 6 at 900). Change it on the Stock screen.
* The mailing address and the Gmail app password (step 3).
* The city of the business address (Elk Grove or City of Sacramento) for the local license.

## Planned after the test

* Close pack purchases from 7:00 PM to 7:00 AM Pacific (Tyson wants to be awake while orders come in, at least at first). Not built yet.

## Sell back switch

Sell back is off for the test run; customers keep cards in the vault or ship them. To turn it on later (Neon SQL editor): `update system_config set buyback_enabled = true;` The site shows Sell back as soon as it is on.

## Before real customers (not setup, but blocking)

* The counsel questions in the revision brief, section 7, starting with the California gambling law opinion.
* Real identity verification in place of the self attested birthdate.
* `update system_config set mode = 'live'` in Neon. This is permanent and turns off every test only path.
