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
  syncLiveCharacterHealth,
  syncLiveCharacterHealthFromRatio,
  syncProfileStats,
} from "./sessionStatsService.js";

const FocusBuddyAuth = {
  init: initExtensionAuth,
  getAuthState,
  signIn,
  signOut,
  recordCompletedSession,
  syncProfileStats,
  syncLiveCharacterHealth,
  syncLiveCharacterHealthFromRatio,
  flushPendingPublicSync,
};

globalThis.FocusBuddyAuth = FocusBuddyAuth;

export { FocusBuddyAuth };
