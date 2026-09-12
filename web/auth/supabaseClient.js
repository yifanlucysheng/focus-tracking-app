import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function getSupabaseConfigStatus() {
  if (!supabaseUrl || !supabasePublishableKey) {
    return {
      ok: false,
      message:
        "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local and add your Supabase project values.",
    };
  }
  return { ok: true };
}

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    "[Focus Buddy] Supabase env vars are not set. Auth will not work until .env.local is configured."
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabasePublishableKey || "placeholder-publishable-key"
);
