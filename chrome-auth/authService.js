import {
  getExtensionSupabaseConfigStatus,
  getSupabase,
  initSupabaseClient,
} from "./supabaseClient.js";

/**
 * @typedef {Object} ExtensionAuthState
 * @property {boolean} configured
 * @property {string} [configMessage]
 * @property {boolean} signedIn
 * @property {{ id: string, email?: string }|null} user
 * @property {{ id: string, username: string, focus_level: number, xp: number, focus_streak: number }|null} profile
 */

/**
 * @param {{ url?: string, publishableKey?: string }} config
 */
export async function initExtensionAuth(config) {
  initSupabaseClient(config);
  // Touch session so persisted chrome.storage tokens are restored.
  await getSupabase().auth.getSession();
  return getAuthState();
}

/**
 * @returns {Promise<ExtensionAuthState>}
 */
export async function getAuthState() {
  const status = getExtensionSupabaseConfigStatus();
  if (!status.ok) {
    return {
      configured: false,
      configMessage: status.message,
      signedIn: false,
      user: null,
      profile: null,
    };
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const session = data.session;
    if (!session?.user) {
      return {
        configured: true,
        signedIn: false,
        user: null,
        profile: null,
      };
    }

    const profile = await fetchOwnProfile(session.user.id);
    return {
      configured: true,
      signedIn: true,
      user: {
        id: session.user.id,
        email: session.user.email,
      },
      profile,
    };
  } catch (err) {
    return {
      configured: true,
      signedIn: false,
      user: null,
      profile: null,
      configMessage: err?.message || "Could not read auth session.",
    };
  }
}

/**
 * Sign in with an existing FocusBuddy website account.
 *
 * @param {{ email: string, password: string }} input
 * @returns {Promise<ExtensionAuthState>}
 */
export async function signIn({ email, password }) {
  assertConfigured();
  if (!email?.trim()) throw new Error("Email is required.");
  if (!password) throw new Error("Password is required.");

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  if (!data.session?.user) throw new Error("Sign in failed — no session returned.");

  return getAuthState();
}

/**
 * @returns {Promise<ExtensionAuthState>}
 */
export async function signOut() {
  assertConfigured();
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
  return getAuthState();
}

/**
 * @param {string} userId
 */
async function fetchOwnProfile(userId) {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select(
      "id, username, focus_level, xp, focus_streak, longest_session_ms, sessions_completed, top_distraction, top_productive_site, character_health"
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function assertConfigured() {
  const status = getExtensionSupabaseConfigStatus();
  if (!status.ok) throw new Error(status.message);
}
