/**
 * Popup auth UI — talks to background FocusBuddyAuth via messages.
 * No direct Supabase calls here.
 */

(function initPopupAuth() {
  const statusEl = document.getElementById("auth-status");
  const formEl = document.getElementById("auth-form");
  const signedInEl = document.getElementById("auth-signed-in");
  const userLineEl = document.getElementById("auth-user-line");
  const errorEl = document.getElementById("auth-error");
  const emailEl = document.getElementById("auth-email");
  const passwordEl = document.getElementById("auth-password");
  const submitEl = document.getElementById("auth-submit");
  const signOutEl = document.getElementById("auth-signout");

  if (!statusEl || !formEl) return;

  /**
   * @param {string} type
   * @param {object} [extra]
   * @returns {Promise<any>}
   */
  function sendAuthMessage(type, extra = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, ...extra }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * @param {any} state
   */
  function renderAuthState(state) {
    errorEl.hidden = true;
    errorEl.textContent = "";

    if (!state?.configured) {
      statusEl.textContent =
        state?.configMessage ||
        "Connect FocusBuddy: add Firebase keys to secrets.local.js (same as web/firebase-config.js).";
      statusEl.classList.add("is-warn");
      formEl.hidden = true;
      signedInEl.hidden = true;
      return;
    }

    statusEl.classList.remove("is-warn");

    if (!state.signedIn) {
      statusEl.textContent =
        "Sign in to your FocusBuddy account so cloud stats can sync when sessions finish.";
      formEl.hidden = false;
      signedInEl.hidden = true;
      return;
    }

    const username = state.profile?.username
      ? `@${state.profile.username}`
      : state.user?.email || "Signed in";
    statusEl.textContent = "FocusBuddy connected";
    userLineEl.textContent = username;
    formEl.hidden = true;
    signedInEl.hidden = false;
  }

  function showError(message) {
    errorEl.hidden = false;
    errorEl.textContent = message || "Something went wrong.";
  }

  async function refresh() {
    statusEl.textContent = "Checking FocusBuddy connection…";
    const state = await sendAuthMessage("GET_AUTH_STATE");
    renderAuthState(state);
  }

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitEl) submitEl.disabled = true;
    errorEl.hidden = true;

    const response = await sendAuthMessage("AUTH_SIGN_IN", {
      email: emailEl?.value ?? "",
      password: passwordEl?.value ?? "",
    });

    if (submitEl) submitEl.disabled = false;

    if (!response?.ok) {
      showError(response?.error || "Sign in failed.");
      return;
    }

    if (passwordEl) passwordEl.value = "";
    renderAuthState(response.state);
  });

  signOutEl?.addEventListener("click", async () => {
    const response = await sendAuthMessage("AUTH_SIGN_OUT");
    if (!response?.ok) {
      showError(response?.error || "Sign out failed.");
      return;
    }
    renderAuthState(response.state);
  });

  void refresh();
})();
