import { getSupabaseConfigStatus, supabase } from "./supabaseClient.js";

/**
 * @typedef {Object} ProfileRow
 * @property {string} id
 * @property {string} username
 * @property {number} focus_level
 * @property {number} xp
 * @property {number} focus_flame
 * @property {string} created_at
 */

/**
 * @param {string} username
 * @returns {string}
 */
export function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} username
 * @returns {string|null} error message, or null if valid
 */
export function validateUsername(username) {
  const value = normalizeUsername(username);
  if (value.length < 3) return "Username must be at least 3 characters.";
  if (value.length > 24) return "Username must be 24 characters or fewer.";
  if (!/^[a-z0-9_]+$/.test(value)) {
    return "Username can only use letters, numbers, and underscores.";
  }
  return null;
}

/**
 * @returns {Promise<import('@supabase/supabase-js').Session|null>}
 */
export async function getSession() {
  assertConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

/**
 * @returns {Promise<ProfileRow|null>}
 */
export async function getCurrentProfile() {
  assertConfigured();
  const session = await getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, focus_level, xp, focus_flame, created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Sign up with email/password, then create a profiles row when a session exists.
 * If email confirmation is required, username is stored in user metadata and
 * the profile is created on the first successful sign-in.
 *
 * @param {{ email: string, password: string, username: string }} input
 * @returns {Promise<{ user: import('@supabase/supabase-js').User|null, session: import('@supabase/supabase-js').Session|null, profile: ProfileRow|null, needsEmailConfirmation: boolean }>}
 */
export async function signUp({ email, password, username }) {
  assertConfigured();

  const normalized = normalizeUsername(username);
  const usernameError = validateUsername(normalized);
  if (usernameError) throw new Error(usernameError);

  if (!email?.trim()) throw new Error("Email is required.");
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const available = await isUsernameAvailable(normalized);
  if (!available) throw new Error("That username is already taken.");

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { username: normalized },
    },
  });

  if (error) throw error;

  let profile = null;
  if (data.session?.user) {
    profile = await createProfileRow(data.session.user.id, normalized);
  }

  return {
    user: data.user ?? null,
    session: data.session ?? null,
    profile,
    needsEmailConfirmation: Boolean(data.user) && !data.session,
  };
}

/**
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ session: import('@supabase/supabase-js').Session, profile: ProfileRow }>}
 */
export async function signIn({ email, password }) {
  assertConfigured();

  if (!email?.trim()) throw new Error("Email is required.");
  if (!password) throw new Error("Password is required.");

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) throw error;
  if (!data.session?.user) throw new Error("Sign in failed — no session returned.");

  const profile = await ensureProfileForUser(data.session.user);
  return { session: data.session, profile };
}

/**
 * @returns {Promise<void>}
 */
export async function signOut() {
  assertConfigured();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Subscribe to auth state changes.
 * @param {(session: import('@supabase/supabase-js').Session|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * @param {string} username
 * @returns {Promise<boolean>}
 */
async function isUsernameAvailable(username) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (error) throw error;
  return !data;
}

/**
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<ProfileRow>}
 */
async function createProfileRow(userId, username) {
  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      username,
      focus_level: 1,
      xp: 0,
      focus_flame: 0,
    })
    .select("id, username, focus_level, xp, focus_flame, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("That username is already taken.");
    }
    throw error;
  }

  return data;
}

/**
 * Create a profile if missing (e.g. after email confirmation).
 * @param {import('@supabase/supabase-js').User} user
 * @returns {Promise<ProfileRow>}
 */
async function ensureProfileForUser(user) {
  const { data: existing, error: readError } = await supabase
    .from("profiles")
    .select("id, username, focus_level, xp, focus_flame, created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const username = normalizeUsername(user.user_metadata?.username || "");
  const usernameError = validateUsername(username);
  if (usernameError) {
    throw new Error(
      "Account has no username yet. Sign up again with a username, or contact support."
    );
  }

  return createProfileRow(user.id, username);
}

function assertConfigured() {
  const status = getSupabaseConfigStatus();
  if (!status.ok) throw new Error(status.message);
}
