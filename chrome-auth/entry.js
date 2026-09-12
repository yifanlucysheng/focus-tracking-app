/**
 * IIFE entry for the Chrome extension service worker / popup messaging layer.
 * Exposes globalThis.FocusBuddyAuth.
 */
import {
  getAuthState,
  initExtensionAuth,
  signIn,
  signOut,
} from "./authService.js";
import {
  flushPendingPublicSync,
  recordCompletedSession,
  syncProfileStats,
} from "./sessionStatsService.js";

const FocusBuddyAuth = {
  init: initExtensionAuth,
  getAuthState,
  signIn,
  signOut,
  recordCompletedSession,
  syncProfileStats,
  flushPendingPublicSync,
};

globalThis.FocusBuddyAuth = FocusBuddyAuth;

export { FocusBuddyAuth };
