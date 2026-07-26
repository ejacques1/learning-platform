# Subscriptions setup

The app is a static `index.html` plus Vercel serverless functions in [api/](api/).
Payments run on your own platform: a logged-in Supabase user clicks **Subscribe**,
pays through Stripe Checkout, and a webhook writes their subscription status back
to Supabase. Paid content is served only to users whose stored status is active.

## 1. Fill in `.env.local`

Every value is blank and needs filling in. Where each one comes from:

| Variable | Secret? | Where to get it |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | **Yes** | Stripe Dashboard → Developers → **API keys** → *Secret key* (`sk_live_…`). Reveal and copy it. |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | **You create this in step 3** by adding a webhook endpoint. Starts with `whsec_`. |
| `STRIPE_PRICE_ID` | No | Already created on your live account: `price_1TxGcgPpfIBUNKpbU196aJFy` ($28/month, *Early Scholars Membership*). |
| `SUPABASE_URL` | No | `https://yzwfyxmmjzqivfapratx.supabase.co` (Supabase → Project Settings → Data API). |
| `SUPABASE_PUBLISHABLE_KEY` | No | `sb_publishable_IoLYxq1UBYlWsT7cbudwQg_3eKnX49u` (Supabase → Project Settings → API Keys → publishable). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase → Project Settings → **API Keys** → `service_role` (secret). Click to reveal. |
| `APP_BASE_URL` | No | Your site's public URL, no trailing slash — e.g. `https://your-domain.com`. |

The only key you have to **create** is the Stripe webhook signing secret (step 3).
The rest already exist — you just copy them.

> The `service_role` key bypasses row level security. It is used only inside
> `api/`, never sent to the browser. If it ever leaks, rotate it in Supabase.

## 2. Deploy

```bash
npm install
```

Add the same variables in **Vercel → Project → Settings → Environment Variables**
(the functions read them at runtime; `.env.local` only covers local development),
then deploy. Note the deployed URL — you need it for the webhook.

## 3. Create the Stripe webhook endpoint

In the Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **Endpoint URL**: `https://<your-domain>/api/stripe-webhook`
- **Events to send** (only these four):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

After creating it, click **Reveal** on the signing secret and put it in
`STRIPE_WEBHOOK_SECRET` (both locally and in Vercel), then redeploy.

To test locally instead, use the Stripe CLI — it prints its own `whsec_` secret,
which is different from the Dashboard one:

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

## 4. Database

Two tables were already created in your Supabase project:

- **`subscriptions`** — one row per user. `status` holds the raw Stripe status
  (`active`, `trialing`, `past_due`, `canceled`, `unpaid`, …). RLS is on: a user
  can read only their own row and cannot write at all. All writes come from the
  webhook using the service role key.
- **`stripe_webhook_events`** — processed Stripe event ids, which is what makes
  the webhook idempotent. RLS is on with no policies, so only the server can
  touch it.

`active` and `trialing` grant access; every other status revokes it.

## 5. Test the flow

1. Sign up / log in on the site.
2. Click **Subscribe** → Stripe Checkout opens with a promo code field.
3. Enter `TESTFREE` to make the first month free, or pay normally.
4. On return, the lessons appear once the webhook lands (a second or two).
5. Cancel the subscription in Stripe → within moments the user loses access.

## How the pieces fit

| File | Role |
| --- | --- |
| [api/config.js](api/config.js) | Serves the browser the public Supabase URL + publishable key, so no keys are hardcoded in `index.html`. |
| [api/create-checkout-session.js](api/create-checkout-session.js) | Verifies the Supabase JWT, then creates a subscription-mode Checkout Session with `allow_promotion_codes`, `client_reference_id`, and metadata. |
| [api/stripe-webhook.js](api/stripe-webhook.js) | Verifies the Stripe signature, dedupes by event id, and writes status to Supabase. |
| [api/subscription-status.js](api/subscription-status.js) | Tells the UI whether to show the Subscribe button or the lessons. |
| [api/paid-content.js](api/paid-content.js) | The actual paywall — returns lessons only to an active subscriber. |

### Why the user id is set in two places

`client_reference_id` and session `metadata` live on the Checkout Session, so
they arrive with `checkout.session.completed`. The `customer.subscription.*`
events carry a Subscription object instead, which does **not** inherit the
session's metadata — so the same id is also set via `subscription_data.metadata`.
Without that, renewals and cancellations could not be matched to a user. There is
also a fallback that looks the user up by `stripe_customer_id`.

### Why gating happens on the server

`index.html` hides the lessons when you are not subscribed, but that is only
presentation — anyone can unhide a DOM element. The lesson text lives in
`api/paid-content.js` and is only ever sent to a request carrying a valid
Supabase token whose stored status is active. To add real lessons, put them
behind that endpoint (or in a table the endpoint reads), not in the HTML.
