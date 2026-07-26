// Reports the logged-in user's subscription status so the UI can decide what
// to show. This drives presentation only — the actual gate is in paid-content.js.
import {
  getServiceClient,
  getSubscription,
  getUserFromRequest,
  isEntitled,
  json,
} from "./_lib/server.js";

export async function GET(request) {
  let supabase;
  try {
    supabase = getServiceClient();
  } catch (err) {
    console.error("Configuration error:", err.message);
    return json({ error: "Server is not configured." }, 500);
  }

  const user = await getUserFromRequest(request, supabase);
  if (!user) return json({ error: "Not authenticated." }, 401);

  try {
    const subscription = await getSubscription(supabase, user.id);
    const status = subscription?.status ?? "none";

    return json({
      status,
      subscribed: isEntitled(status),
      cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
      currentPeriodEnd: subscription?.current_period_end ?? null,
    });
  } catch (err) {
    console.error("Failed to read subscription status:", err);
    return json({ error: "Could not load subscription status." }, 500);
  }
}
