import {
  loadCurrentProfile,
  signIn,
  signOut,
  signUp,
} from "./authService.js";
import { getSupabaseConfigStatus } from "./supabaseClient.js";

/**
 * @typedef {import('./authService.js').ProfileRow} ProfileRow
 */

/**
 * Full-page Sign In / Create Account UI.
 * Auth queries live in authService.js only.
 *
 * @param {HTMLElement} root
 * @param {{ onAuthenticated?: (profile: ProfileRow) => void }} [options]
 */
export function mountAuthPage(root, options = {}) {
  if (!root) return;

  const config = getSupabaseConfigStatus();
  /** @type {'signin' | 'signup'} */
  let mode = "signin";
  /** @type {string} */
  let statusMessage = "";
  /** @type {'idle' | 'error' | 'success'} */
  let statusKind = "idle";
  let busy = false;

  /**
   * @param {'idle' | 'error' | 'success'} kind
   * @param {string} message
   */
  function setStatus(kind, message) {
    statusKind = kind;
    statusMessage = message;
  }

  function render() {
    if (!config.ok) {
      root.innerHTML = `
        <div class="auth-card">
          <p class="field-label">Account</p>
          <p class="auth-status is-error">${escapeHtml(config.message)}</p>
        </div>
      `;
      return;
    }

    const isSignUp = mode === "signup";
    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-mode-toggle" role="tablist" aria-label="Account mode">
          <button type="button" class="auth-mode-btn ${!isSignUp ? "is-active" : ""}" data-mode="signin" role="tab" aria-selected="${!isSignUp}">
            Sign In
          </button>
          <button type="button" class="auth-mode-btn ${isSignUp ? "is-active" : ""}" data-mode="signup" role="tab" aria-selected="${isSignUp}">
            Create Account
          </button>
        </div>

        <form id="auth-form" class="auth-form" novalidate>
          ${
            isSignUp
              ? `
            <label class="field-label" for="auth-username">Username</label>
            <input id="auth-username" class="field-input" type="text" name="username" autocomplete="username" placeholder="focusfox" required />
          `
              : ""
          }

          <label class="field-label" for="auth-email">Email</label>
          <input id="auth-email" class="field-input" type="email" name="email" autocomplete="email" placeholder="you@example.com" required />

          <label class="field-label" for="auth-password">Password</label>
          <input id="auth-password" class="field-input" type="password" name="password" autocomplete="${isSignUp ? "new-password" : "current-password"}" placeholder="••••••••" required minlength="6" />

          <button id="auth-submit-btn" class="btn auth-submit-btn" type="submit" ${busy ? "disabled" : ""}>
            ${busy ? "Please wait…" : isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>
        ${statusHtml()}
      </div>
    `;

    root.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.getAttribute("data-mode") === "signup" ? "signup" : "signin";
        setStatus("idle", "");
        render();
      });
    });

    root.querySelector("#auth-form")?.addEventListener("submit", onSubmit);
  }

  function statusHtml() {
    if (!statusMessage) return `<p class="auth-status" aria-live="polite"></p>`;
    return `<p class="auth-status is-${statusKind}" aria-live="polite">${escapeHtml(statusMessage)}</p>`;
  }

  /**
   * @param {SubmitEvent} event
   */
  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;

    const form = /** @type {HTMLFormElement} */ (event.target);
    const email = /** @type {HTMLInputElement|null} */ (form.querySelector("#auth-email"))?.value ?? "";
    const password =
      /** @type {HTMLInputElement|null} */ (form.querySelector("#auth-password"))?.value ?? "";
    const username =
      /** @type {HTMLInputElement|null} */ (form.querySelector("#auth-username"))?.value ?? "";

    busy = true;
    setStatus("idle", "");
    render();

    try {
      if (mode === "signup") {
        const result = await signUp({ email, password, username });
        if (result.needsEmailConfirmation) {
          setStatus(
            "success",
            "Account created. Check your email to confirm, then sign in."
          );
          mode = "signin";
        } else if (result.profile) {
          options.onAuthenticated?.(result.profile);
          return;
        }
      } else {
        const result = await signIn({ email, password });
        options.onAuthenticated?.(result.profile);
        return;
      }
    } catch (err) {
      setStatus("error", err?.message || "Something went wrong.");
    } finally {
      busy = false;
      render();
    }
  }

  render();
}

/**
 * Signed-in account summary + Sign Out (dashboard Account section).
 *
 * @param {HTMLElement} root
 * @param {{
 *   profile: ProfileRow|null,
 *   onSignedOut?: () => void,
 * }} [options]
 */
export function mountAccountBar(root, options = {}) {
  if (!root) return;

  const profile = options.profile;
  let busy = false;

  function render() {
    if (!profile) {
      root.innerHTML = "";
      return;
    }

    root.innerHTML = `
      <div class="auth-card auth-card-signed-in">
        <p class="field-label">Signed in</p>
        <p class="auth-username">@${escapeHtml(profile.username)}</p>
        <p class="auth-meta">Level ${profile.focus_level} · ${profile.xp} XP · Flame ${profile.focus_flame}</p>
        <button id="auth-signout-btn" class="btn btn-secondary btn-small" type="button" ${busy ? "disabled" : ""}>
          Sign Out
        </button>
        <p class="auth-status" aria-live="polite"></p>
      </div>
    `;

    root.querySelector("#auth-signout-btn")?.addEventListener("click", onSignOut);
  }

  async function onSignOut() {
    if (busy) return;
    busy = true;
    render();

    const statusEl = root.querySelector(".auth-status");
    try {
      await signOut();
      options.onSignedOut?.();
    } catch (err) {
      busy = false;
      render();
      if (statusEl) {
        statusEl.classList.add("is-error");
        statusEl.textContent = err?.message || "Could not sign out.";
      }
    }
  }

  render();
}

/**
 * Load (and ensure) the profile for an already-authenticated session.
 * Thin wrapper so UI never talks to Supabase tables directly.
 * @returns {Promise<ProfileRow|null>}
 */
export async function loadSignedInProfile() {
  return loadCurrentProfile();
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
