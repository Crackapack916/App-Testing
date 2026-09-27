# CrackAPack setup runbook

Everything that needs an account or a secret. Each step says where the value goes. Secrets never go in the repo: use the GitHub, Vercel or EAS secret stores named below.

Status key: **you** = needs your account or approval, **Claude** = can be done from a session once the keys exist.

## 1. GitHub (you)

| Step | Where |
|---|---|
| Merge `claude/crackapack-mobile-app-hq1y9g` into the default branch | GitHub pull request |
| Add secret `NEON_DATABASE_URL` (Neon direct connection string, project `crackapack`) | Repo → Settings → Secrets and variables → Actions |
| Run **mtgjson** with "Also import every card" checked | Repo → Actions → mtgjson → Run workflow |

After the merge, the **jobs** workflow locks queues at the cutoff and releases held buybacks every 15 minutes, and **mtgjson** refreshes prices every morning.

## 2. Clerk: sign in (you)

| Step | Where |
|---|---|
| Create an application | dashboard.clerk.com |
| Enable Email code, Google, and Apple | User & authentication → SSO connections |
| Add the email claim: `{"email": "{{user.primary_email_address}}"}` | Sessions → Customize session token |
| For Apple on iOS: add the app (Team ID + bundle id `com.crackapack.app`) | Native applications |
| Copy the **publishable key** | API keys |
| Copy the **JWT public key (PEM)** | API keys → Show JWT public key |

| Value | Goes to |
|---|---|
| Publishable key | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (EAS env) and `VITE_CLERK_PUBLISHABLE_KEY` (Vercel, ops project) |
| JWT public key (PEM) | `CLERK_JWT_KEY` (Vercel, API project) |
| Ops site origin, e.g. `https://crackapack-ops.vercel.app` | `CLERK_AUTHORIZED_PARTIES` (Vercel, API project) |

Staff: everyone signs in as a customer first. Promote staff with `POST /staff/team/role` (admin only) or, for the very first admin, in the Neon SQL editor: `select set_user_role('you@example.com', 'admin', null);`

## 3. Mux: recording and clips (you)

| Step | Where |
|---|---|
| Create an access token with Mux Video read and write | Settings → Access tokens |
| Create one live stream, playback policy public, reconnect window 60s | Video → Live streams |
| Put its stream key in OBS (Settings → Stream → Service: Custom, server `rtmps://global-live.mux.com:443/app`) | OBS |
| Add a webhook to `https://<api>/webhooks/mux` | Settings → Webhooks |

| Value | Goes to (Vercel, API project) |
|---|---|
| Token id / secret | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` |
| Live stream id | `MUX_LIVE_STREAM_ID` |
| Webhook signing secret | `MUX_WEBHOOK_SECRET` |

Start the OBS stream before pressing **Start filmed session**. Clips are cut from the live recording automatically; a failed clip shows **retry** on the Notify screen.

## 4. Stripe: credits (you)

| Step | Where |
|---|---|
| Copy the sandbox secret key (`sk_test_...`) | Stripe dashboard, "Crack A Pack sandbox" → Developers → API keys |
| Add a webhook to `https://<api>/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` | Developers → Webhooks |

| Value | Goes to (Vercel, API project) |
|---|---|
| Secret key | `STRIPE_SECRET_KEY` |
| Webhook signing secret | `STRIPE_WEBHOOK_SECRET` |
| `false` until live | `STRIPE_LIVEMODE` |

Also apply to one high risk processor as the backup (context file section 8).

## 5. Vercel: hosting (you approve, Claude deploys)

The connected account is on the Hobby plan, which is for non commercial use. Upgrade to **Pro** before real customers.

| Project | Root | Settings |
|---|---|---|
| `crackapack-api` | `apps/api` | Framework Hono. Env: `NODE_ENV=production`, `DATABASE_URL` (Neon **pooled** string), `PG_POOL_MAX=3`, `JWT_SECRET` (random 32+ chars), plus the Clerk, Mux and Stripe values above |
| `crackapack-ops` | `apps/staff` | Framework Vite. Build `VITE_BASE=/ vite build`. Env: `VITE_API_BASE=https://<api>`, `VITE_CLERK_PUBLISHABLE_KEY` |

The API refuses to start in production without `CLERK_JWT_KEY`, and never allows `DEV_LOGIN` or `TEST_CLOCK` there.

## 6. Expo: the app on your phone (you)

| Step | Command or place |
|---|---|
| Create a free account | expo.dev |
| Log in and link the project (adds the EAS project id to `app.json`) | `cd apps/mobile && npx eas-cli@latest login && npx eas-cli@latest init` |
| Set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `npx eas-cli@latest env:create` (or expo.dev → project → Environment variables) |
| Android development build (free) | `npx eas-cli@latest build --profile development --platform android` |
| iOS development build (needs an Apple Developer account, $99/year, also required for Sign in with Apple) | `npx eas-cli@latest build --profile development --platform ios` |

Install the build from the link EAS prints, then check on the device: the pack tear sound and haptic, the foil shimmer following tilt, the big hit cue, and a real "You just cracked a pack" push.

## Before real customers (not setup, but blocking)

* The California gambling law opinion on this structure (context file sections 3 and 10).
* Real identity verification in place of the self attested birthdate.
* `update system_config set mode = 'live'` in Neon. This is permanent and turns off every test only path.
