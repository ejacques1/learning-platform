// Stripe webhook receiver.
//
// Every request is signature-verified before it is trusted, processed exactly
// once (via a claim row keyed on the Stripe event id), and out-of-order
// deliveries are ignored. Subscription state is written with the Supabase
// service role key, which never leaves the server.
import {
  getServiceClient,
  getStripe,
  isEntitled,
  json,
  requireEnv,
} from "./_lib/server.js";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(request) {
  let stripe;
  let supabase;
  let webhookSecret;
  try {
    stripe = getStripe();
    supabase = getServiceClient();
    webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
  } catch (err) {
    console.error("Webhook configuration error:", err.message);
    return json({ error: "Server is not configured." }, 500);
  }

  // The signature is computed over the exact bytes Stripe sent, so the body
  // must be read raw. Parsing it first would break verification.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event;
  try {
    if (!signature) throw new Error("Missing stripe-signature header");
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    // Anything that fails verification is rejected without being processed.
    console.warn("Rejected webhook with invalid signature:", err.message);
    return json({ error: "Invalid signature." }, 400);
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return json({ received: true, ignored: event.type });
  }

  // Idempotency: claim the event id. A duplicate delivery hits the primary key
  // and is skipped rather than reprocessed.
  const { error: claimError } = await supabase
    .from("stripe_webhook_events")
    .insert({ id: event.id, type: event.type });

  if (claimError) {
    if (claimError.code === "23505") {
      return json({ received: true, duplicate: true });
    }
    console.error("Failed to record webhook event:", claimError.message);
    return json({ error: "Could not record event." }, 500);
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(stripe, supabase, event);
    } else {
      await handleSubscriptionChange(supabase, event);
    }
    return json({ received: true });
  } catch (err) {
    // Release the claim so Stripe's retry can process this event again.
    await supabase.from("stripe_webhook_events").delete().eq("id", event.id);
    console.error(`Failed to process ${event.type} (${event.id}):`, err);
    return json({ error: "Processing failed." }, 500);
  }
}

async function handleCheckoutCompleted(stripe, supabase, event) {
  const session = event.data.object;
  if (session.mode !== "subscription") return;

  const userId = session.client_reference_id || session.metadata?.supabase_user_id;
  if (!userId) {
    throw new Error(`Checkout Session ${session.id} has no Supabase user id`);
  }
  if (!session.subscription) {
    throw new Error(`Checkout Session ${session.id} has no subscription`);
  }

  // Fetch the subscription rather than trusting the session snapshot, so the
  // stored status reflects the real state at the moment of processing.
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await upsertSubscription(supabase, userId, subscription, event.created);
}

async function handleSubscriptionChange(supabase, event) {
  const subscription = event.data.object;

  let userId = subscription.metadata?.supabase_user_id;

  // Subscriptions created outside this checkout flow (e.g. from the Stripe
  // Dashboard) carry no metadata, so fall back to the stored customer id.
  if (!userId) {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer?.id;

    if (customerId) {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (error) throw new Error(`Customer lookup failed: ${error.message}`);
      userId = data?.user_id;
    }
  }

  if (!userId) {
    // Nothing to update — log it rather than failing, so Stripe does not retry
    // an event that can never be mapped to a user.
    console.warn(
      `No Supabase user for subscription ${subscription.id}; skipping.`,
    );
    return;
  }

  await upsertSubscription(supabase, userId, subscription, event.created);
}

async function upsertSubscription(supabase, userId, subscription, eventCreated) {
  const eventAt = new Date(eventCreated * 1000).toISOString();

  // Drop events older than the one already applied. Stripe does not guarantee
  // delivery order, and a late "active" must not overwrite a newer "canceled".
  const { data: current, error: readError } = await supabase
    .from("subscriptions")
    .select("last_stripe_event_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read subscription: ${readError.message}`);
  }
  // Compare as timestamps: Postgres returns "+00:00" offsets while toISOString
  // produces "Z", so comparing the raw strings would give the wrong answer.
  const appliedAt = current?.last_stripe_event_at
    ? Date.parse(current.last_stripe_event_at)
    : null;
  if (appliedAt !== null && appliedAt > Date.parse(eventAt)) {
    console.log(`Ignoring stale event for user ${userId}.`);
    return;
  }

  const item = subscription.items?.data?.[0];

  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      status: subscription.status,
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id,
      stripe_subscription_id: subscription.id,
      stripe_price_id: item?.price?.id ?? null,
      stripe_product_id:
        typeof item?.price?.product === "string" ? item.price.product : null,
      // current_period_end moved onto the subscription item in newer API
      // versions; read whichever one this account's version provides.
      current_period_end: toIso(
        subscription.current_period_end ?? item?.current_period_end,
      ),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      last_stripe_event_at: eventAt,
    },
    { onConflict: "user_id" },
  );

  if (error) throw new Error(`Failed to save subscription: ${error.message}`);

  console.log(
    `User ${userId} is now ${subscription.status} (entitled: ${isEntitled(subscription.status)}).`,
  );
}

function toIso(unixSeconds) {
  return typeof unixSeconds === "number"
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
}
