import { getSupabaseConfigStatus, supabase } from "./supabaseClient.js";

/**
 * @typedef {Object} ProfileRow
 * @property {string} id
 * @property {string} username
 * @property {number} focus_level
 * @property {number} xp
 * @property {number} focus_streak
 * @property {string} created_at
 */

const PROFILE_COLUMNS = "id, username, focus_level, xp, focus_streak, created_at";

/** @type {ProfileRow|null} */
let cachedProfile = null;

/**
 * In-memory profile for the signed-in user. Prefer this after boot / sign-in.
 * @returns {ProfileRow|null}
 */
export function getCachedProfile() {
  return cachedProfile;
}

/**
 * @param {ProfileRow|null} profile
 */
export function setCachedProfile(profile) {
  cachedProfile = profile;
}

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
 * Fetch the profiles row for a user id (no create).
 * Safe to call from auth listeners — does not call getSession().
 *
 * @param {string} userId
 * @returns {Promise<ProfileRow|null>}
 */
export async function getProfileByUserId(userId) {
  assertConfigured();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Read the signed-in user's profile (no create). Returns null if signed out or missing.
 * @returns {Promise<ProfileRow|null>}
 */
export async function getCurrentProfile() {
  assertConfigured();
  const session = await getSession();
  if (!session?.user) {
    cachedProfile = null;
    return null;
  }

  const profile = await getProfileByUserId(session.user.id);
  cachedProfile = profile;
  return profile;
}

/**
 * Ensure a profiles row exists for this auth user, cache it, and return it.
 * Use after sign-in / session restore. Prefer this over getCurrentProfile when
 * the app needs a guaranteed profile.
 *
 * Safe to call with a User from onAuthStateChange (does not call getSession).
 *
 * @param {import('@supabase/supabase-js').User} user
 * @returns {Promise<ProfileRow>}
 */
export async function ensureProfileForUser(user) {
  assertConfigured();
  if (!user?.id) throw new Error("Missing auth user.");

  const existing = await getProfileByUserId(user.id);
  if (existing) {
    cachedProfile = existing;
    return existing;
  }

  const username = normalizeUsername(user.user_metadata?.username || "");
  const usernameError = validateUsername(username);
  if (usernameError) {
    throw new Error(
      "Account has no username yet. Sign up again with a username, or contact support."
    );
  }

  const profile = await createProfileRow(user.id, username);
  cachedProfile = profile;
  return profile;
}

/**
 * Load session → ensure profiles row → cache. Returns null if signed out.
 * @returns {Promise<ProfileRow|null>}
 */
export async function loadCurrentProfile() {
  assertConfigured();
  const session = await getSession();
  if (!session?.user) {
    cachedProfile = null;
    return null;
  }
  return ensureProfileForUser(session.user);
}

/**
 * Sign up with email/password, then create a profiles row when a session exists.
 * If email confirmation is required, username is stored in user metadata and
 * the profile is created on the first successful sign-in (or by the DB trigger).
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
    profile = await ensureProfileForUser(data.session.user);
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
  cachedProfile = null;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Subscribe to auth state changes.
 * Callback receives the session only — resolve the profile with
 * ensureProfileForUser(session.user) (do not call getSession inside the callback).
 *
 * @param {(session: import('@supabase/supabase-js').Session|null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) cachedProfile = null;
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
      focus_streak: 0,
    })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    // Concurrent insert (client + DB trigger) or username race — re-fetch by id.
    if (error.code === "23505") {
      const existing = await getProfileByUserId(userId);
      if (existing) return existing;
      throw new Error("That username is already taken.");
    }
    throw error;
  }

  return data;
}

function assertConfigured() {
  const status = getSupabaseConfigStatus();
  if (status.ok) return;
  throw new Error(status.message);
}
