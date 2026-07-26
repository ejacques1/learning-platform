// Creates a Stripe Checkout Session in subscription mode for the logged-in user.
import {
  getBaseUrl,
  getServiceClient,
  getStripe,
  getSubscription,
  getUserFromRequest,
  isEntitled,
  json,
  requireEnv,
} from "./_lib/server.js";

export async function POST(request) {
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (err) {
    console.error("Configuration error:", err.message);
    return json({ error: "Server is not configured." }, 500);
  }

  // The user id comes from the verified Supabase JWT, never from the request
  // body — otherwise anyone could subscribe (or be subscribed) as someone else.
  const user = await getUserFromRequest(request, supabase);
  if (!user) return json({ error: "You must be logged in to subscribe." }, 401);

  try {
    const stripe = getStripe();
    const priceId = requireEnv("STRIPE_PRICE_ID");
    const existing = await getSubscription(supabase, user.id);

    if (existing && isEntitled(existing.status)) {
      return json({ error: "You already have an active subscription." }, 409);
    }

    const baseUrl = getBaseUrl(request);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],

      // Lets the promo code field (e.g. TESTFREE) appear at checkout.
      allow_promotion_codes: true,

      // client_reference_id and metadata land on the Checkout Session, which is
      // what checkout.session.completed carries.
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },

      // The customer.subscription.* events carry a Subscription object, which
      // does NOT inherit the session's metadata. Setting it here copies the id
      // onto the Subscription so every lifecycle event can be mapped to a user.
      subscription_data: { metadata: { supabase_user_id: user.id } },

      // Reuse the Stripe customer if this user has subscribed before, so their
      // billing history stays on one customer record.
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email }),

      success_url: `${baseUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("Failed to create Checkout Session:", err);
    return json({ error: "Could not start checkout. Please try again." }, 500);
  }
}
