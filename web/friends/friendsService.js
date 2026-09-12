import {
  getCachedProfile,
  getSession,
  normalizeUsername,
  validateUsername,
} from "../auth/authService.js";
import { getSupabaseConfigStatus, supabase } from "../auth/supabaseClient.js";

/**
 * @typedef {import('../auth/authService.js').ProfileRow} ProfileRow
 */

/**
 * @typedef {'pending' | 'accepted' | 'rejected'} FriendshipStatus
 */

/**
 * @typedef {Object} FriendshipRow
 * @property {string} id
 * @property {string} requester_id
 * @property {string} addressee_id
 * @property {FriendshipStatus} status
 * @property {string} created_at
 */

/**
 * @typedef {Object} FriendshipWithProfiles
 * @property {string} id
 * @property {string} requester_id
 * @property {string} addressee_id
 * @property {FriendshipStatus} status
 * @property {string} created_at
 * @property {ProfileRow} requester
 * @property {ProfileRow} addressee
 */

const PROFILE_COLUMNS = "id, username, focus_level, xp, focus_streak, created_at";
const FRIENDSHIP_COLUMNS = "id, requester_id, addressee_id, status, created_at";

/**
 * Look up a public profile by unique username.
 *
 * @param {string} username
 * @returns {Promise<ProfileRow|null>}
 */
export async function searchUserByUsername(username) {
  assertConfigured();

  const normalized = normalizeUsername(username);
  const usernameError = validateUsername(normalized);
  if (usernameError) throw new Error(usernameError);

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("username", normalized)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Active (pending or accepted) friendship between the current user and another profile, if any.
 *
 * @param {string} otherUserId
 * @returns {Promise<FriendshipRow|null>}
 */
export async function getActiveFriendshipWith(otherUserId) {
  assertConfigured();

  const me = await requireCurrentUserId();
  if (!otherUserId || otherUserId === me) return null;

  const { data, error } = await supabase
    .from("friendships")
    .select(FRIENDSHIP_COLUMNS)
    .in("status", ["pending", "accepted"])
    .or(
      `and(requester_id.eq.${me},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${me})`
    )
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Send a pending friend request to another user (by their profile id).
 *
 * @param {string} addresseeId
 * @returns {Promise<FriendshipRow>}
 */
export async function sendFriendRequest(addresseeId) {
  assertConfigured();

  const me = await requireCurrentUserId();
  if (!addresseeId) throw new Error("Friend id is required.");
  if (addresseeId === me) {
    throw new Error("You cannot send a friend request to yourself.");
  }

  const target = await getProfileById(addresseeId);
  if (!target) throw new Error("That user was not found.");

  const { data, error } = await supabase
    .from("friendships")
    .insert({
      requester_id: me,
      addressee_id: addresseeId,
      status: "pending",
    })
    .select(FRIENDSHIP_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A friend request already exists between you and this user.");
    }
    if (error.code === "23514") {
      throw new Error("You cannot send a friend request to yourself.");
    }
    throw error;
  }

  return data;
}

/**
 * Pending requests where the current user is the addressee.
 *
 * @returns {Promise<FriendshipWithProfiles[]>}
 */
export async function getIncomingPendingRequests() {
  assertConfigured();
  const me = await requireCurrentUserId();
  return listFriendshipsWithProfiles({
    column: "addressee_id",
    userId: me,
    status: "pending",
  });
}

/**
 * Pending requests the current user has sent.
 *
 * @returns {Promise<FriendshipWithProfiles[]>}
 */
export async function getOutgoingPendingRequests() {
  assertConfigured();
  const me = await requireCurrentUserId();
  return listFriendshipsWithProfiles({
    column: "requester_id",
    userId: me,
    status: "pending",
  });
}

/**
 * Accept a pending request addressed to the current user.
 *
 * @param {string} friendshipId
 * @returns {Promise<FriendshipRow>}
 */
export async function acceptFriendRequest(friendshipId) {
  return respondToFriendRequest(friendshipId, "accepted");
}

/**
 * Reject a pending request addressed to the current user.
 *
 * @param {string} friendshipId
 * @returns {Promise<FriendshipRow>}
 */
export async function rejectFriendRequest(friendshipId) {
  return respondToFriendRequest(friendshipId, "rejected");
}

/**
 * Accepted friends for the current user (either direction).
 * Returns the other user's profile for each friendship.
 *
 * @returns {Promise<Array<{ friendship: FriendshipRow, friend: ProfileRow }>>}
 */
export async function getAcceptedFriends() {
  assertConfigured();
  const me = await requireCurrentUserId();

  const { data, error } = await supabase
    .from("friendships")
    .select(
      `
      ${FRIENDSHIP_COLUMNS},
      requester:profiles!requester_id (${PROFILE_COLUMNS}),
      addressee:profiles!addressee_id (${PROFILE_COLUMNS})
    `
    )
    .eq("status", "accepted")
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => {
    const friendship = pickFriendship(row);
    const friend =
      row.requester_id === me
        ? /** @type {ProfileRow} */ (row.addressee)
        : /** @type {ProfileRow} */ (row.requester);
    return { friendship, friend };
  });
}

/**
 * Map a profiles row into the leaderboard FriendProfile shape.
 *
 * @param {ProfileRow} profile
 * @param {{ isCurrentUser?: boolean, characterId?: string }} [options]
 * @returns {import('./friendTypes.js').FriendProfile}
 */
export function profileToFriendProfile(profile, options = {}) {
  return {
    id: profile.id,
    username: profile.username,
    focusLevel: profile.focus_level ?? 1,
    xp: profile.xp ?? 0,
    focusStreak: profile.focus_streak ?? profile.focus_flame ?? 0,
    characterId: options.characterId || "sleepbunny",
    isCurrentUser: Boolean(options.isCurrentUser),
    isMock: false,
  };
}

/**
 * @param {string} friendshipId
 * @param {'accepted' | 'rejected'} status
 * @returns {Promise<FriendshipRow>}
 */
async function respondToFriendRequest(friendshipId, status) {
  assertConfigured();

  const me = await requireCurrentUserId();
  if (!friendshipId) throw new Error("Request id is required.");

  const { data, error } = await supabase
    .from("friendships")
    .update({ status })
    .eq("id", friendshipId)
    .eq("addressee_id", me)
    .eq("status", "pending")
    .select(FRIENDSHIP_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error(
      status === "accepted"
        ? "Pending request not found (or you are not the addressee)."
        : "Pending request not found (or you are not the addressee)."
    );
  }

  return data;
}

/**
 * @param {{ column: 'requester_id' | 'addressee_id', userId: string, status: FriendshipStatus }} opts
 * @returns {Promise<FriendshipWithProfiles[]>}
 */
async function listFriendshipsWithProfiles({ column, userId, status }) {
  const { data, error } = await supabase
    .from("friendships")
    .select(
      `
      ${FRIENDSHIP_COLUMNS},
      requester:profiles!requester_id (${PROFILE_COLUMNS}),
      addressee:profiles!addressee_id (${PROFILE_COLUMNS})
    `
    )
    .eq(column, userId)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data || []).map((row) => ({
    ...pickFriendship(row),
    requester: /** @type {ProfileRow} */ (row.requester),
    addressee: /** @type {ProfileRow} */ (row.addressee),
  }));
}

/**
 * @param {string} profileId
 * @returns {Promise<ProfileRow|null>}
 */
async function getProfileById(profileId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", profileId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * @returns {Promise<string>}
 */
async function requireCurrentUserId() {
  const cached = getCachedProfile();
  if (cached?.id) return cached.id;

  const session = await getSession();
  if (!session?.user?.id) throw new Error("You must be signed in.");
  return session.user.id;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {FriendshipRow}
 */
function pickFriendship(row) {
  return {
    id: /** @type {string} */ (row.id),
    requester_id: /** @type {string} */ (row.requester_id),
    addressee_id: /** @type {string} */ (row.addressee_id),
    status: /** @type {FriendshipStatus} */ (row.status),
    created_at: /** @type {string} */ (row.created_at),
  };
}

function assertConfigured() {
  const status = getSupabaseConfigStatus();
  if (!status.ok) throw new Error(status.message);
}
