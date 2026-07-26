// The real paywall. Paid content lives here and is only ever sent to a verified
// user whose stored subscription status is active — it is never shipped to the
// browser and hidden with CSS, which anyone could undo with devtools.
import {
  getServiceClient,
  getSubscription,
  getUserFromRequest,
  isEntitled,
  json,
} from "./_lib/server.js";

const LESSONS = [
  {
    title: "Lesson 1 — Getting Started",
    body: "Set your goals for the term and learn how to structure a study session that actually sticks.",
  },
  {
    title: "Lesson 2 — Building a Study Habit",
    body: "Short, consistent practice beats cramming. Build a weekly routine you can keep.",
  },
  {
    title: "Lesson 3 — Practice and Review",
    body: "Use spaced review to lock in what you have learned and find the gaps early.",
  },
];

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

    if (!isEntitled(status)) {
      return json({ error: "An active subscription is required.", status }, 403);
    }

    return json({ lessons: LESSONS });
  } catch (err) {
    console.error("Failed to load paid content:", err);
    return json({ error: "Could not load content." }, 500);
  }
}
