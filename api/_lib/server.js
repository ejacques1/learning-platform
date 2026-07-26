// Shared server-side helpers. Everything in this file runs only in Vercel
// Functions — never in the browser. Files under api/_lib are not routes.
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// Stripe subscription statuses that entitle a user to the paid content.
// Anything else (canceled, unpaid, past_due, incomplete, paused, ...) does not.
export const ENTITLED_STATUSES = ["active", "trialing"];

export function isEntitled(status) {
  return ENTITLED_STATUSES.includes(status);
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function getStripe() {
  // No apiVersion pin: stripe-node defaults to the version it ships with, so
  // the SDK and the API it calls always agree.
  return new Stripe(requireEnv("STRIPE_SECRET_KEY"));
}

// Service-role client. Bypasses RLS, so it must never be exposed to the client.
export function getServiceClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Resolves the caller's Supabase user from the Authorization header. The token
// is verified by Supabase, so the user id can be trusted — unlike anything the
// browser sends in a request body.
export async function getUserFromRequest(request, supabase) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// Reads the current subscription row for a user. Missing row means never subscribed.
export async function getSubscription(supabase, userId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "status, current_period_end, cancel_at_period_end, stripe_customer_id",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read subscription: ${error.message}`);
  return data;
}

// The base URL used for Checkout redirects. Prefers an explicit env var so the
// value is stable across preview deployments; falls back to the request origin.
export function getBaseUrl(request) {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}
