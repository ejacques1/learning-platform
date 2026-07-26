# learning-platform

Early Scholars learning platform — a static frontend with Supabase email/password
auth and Stripe subscriptions ($28/month), running on Vercel Functions.

- [index.html](index.html) — the app (auth, subscribe button, gated lessons)
- [api/](api/) — serverless functions: checkout, Stripe webhook, paywall
- [SETUP.md](SETUP.md) — environment variables, webhook setup, and how it fits together

Fill in [.env.local](.env.local) before running anything; see SETUP.md for where
each key comes from.
