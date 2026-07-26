// Serves the browser the *public* Supabase config, so no keys are hardcoded in
// index.html. Only publishable values are returned here — never a secret key.
import { json, requireEnv } from "./_lib/server.js";

export async function GET() {
  try {
    return json({
      supabaseUrl: requireEnv("SUPABASE_URL"),
      supabasePublishableKey: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
    });
  } catch (err) {
    console.error("Configuration error:", err.message);
    return json({ error: "Server is not configured." }, 500);
  }
}
