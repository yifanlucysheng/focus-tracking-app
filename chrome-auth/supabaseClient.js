import { createClient } from "@supabase/supabase-js";
import { createChromeStorageAdapter } from "./chromeStorageAdapter.js";

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let client = null;

/** @type {{ ok: true } | { ok: false, message: string }} */
let configStatus = {
  ok: false,
  message: "Supabase is not configured for the extension yet.",
};

/**
 * @param {{ url?: string, publishableKey?: string }} config
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function initSupabaseClient(config) {
  const url = String(config?.url || "").trim();
  const publishableKey = String(config?.publishableKey || "").trim();

  if (!url || !publishableKey) {
    configStatus = {
      ok: false,
      message:
        "Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to secrets.local.js (same values as the website .env.local). Never use the secret/service-role key.",
    };
    client = null;
    throw new Error(configStatus.message);
  }

  if (publishableKey.includes("service_role")) {
    configStatus = {
      ok: false,
      message: "Refusing to use a service-role key in the extension. Use the publishable key only.",
    };
    client = null;
    throw new Error(configStatus.message);
  }

  client = createClient(url, publishableKey, {
    auth: {
      storage: createChromeStorageAdapter(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  configStatus = { ok: true };
  return client;
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getSupabase() {
  if (!client) {
    throw new Error(
      configStatus.ok
        ? "Supabase client was not initialized."
        : configStatus.message
    );
  }
  return client;
}

export function getExtensionSupabaseConfigStatus() {
  return configStatus;
}
