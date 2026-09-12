# Focus Buddy

Chrome extension + standalone website for focus tracking.

## Website (Supabase auth)

The friends/account UI lives in `web/` and uses Vite so Supabase keys stay in env vars.

### 1. Install

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` → `.env.local` and fill in values from
**Supabase → Project Settings → API**:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) — never the secret key |

Never commit `.env.local`.

### 3. Create the `profiles` table

In the Supabase SQL Editor, run the full script:

[`supabase/profiles.sql`](supabase/profiles.sql)

That creates `profiles` (`id` = `auth.users.id`, unique `username`, `focus_level`, `xp`, `focus_streak`), RLS policies, and a trigger that inserts a profile row on signup from username metadata.

If you already ran an older version of this file, re-run it so the `handle_new_user` trigger is installed.

Also enable **Email** auth under **Authentication → Providers**.

### 3b. Create the `friendships` table

In the Supabase SQL Editor, run:

[`supabase/friendships.sql`](supabase/friendships.sql)

Client helpers live in [`web/friends/friendsService.js`](web/friends/friendsService.js). Add Friend, Friend Requests, and the leaderboard use real accepted friendships from Supabase.

Public profile fields (`username`, `focus_level`, `xp`, `focus_streak`) are **read from Supabase** on website load (authoritative). Local storage is only a cache. Supabase is updated only when a real event changes stats (e.g. `recordCompletedSession`) — never by pushing stale local values on page load. Private session details stay local.

If your project still has a `focus_flame` column, run [`supabase/rename_focus_flame_to_streak.sql`](supabase/rename_focus_flame_to_streak.sql) once in the SQL Editor.

`profiles.xp` is **XP toward the next level** (with `focus_level`), not lifetime XP. If your rows still store legacy lifetime XP, run [`supabase/migrate_xp_to_progress.sql`](supabase/migrate_xp_to_progress.sql) once. Session XP rules live in [`web/profile/xp.js`](web/profile/xp.js) (15 XP/min + 25 on complete; `75 + 20L + 5L²` to level up).

### 4. Run the website

```bash
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

After sign-up / sign-in / page reload, the client loads the current user's `profiles` row from Supabase (authoritative for public stats) and keeps it in memory via `getCachedProfile()`.

## Chrome extension auth

The extension uses the **same** Supabase project and FocusBuddy accounts as the website.

**Load the packaged extension from `dist/`** (not the website `dist-web/`):

```bash
npm run build:extension
# or: npm run build   # website → dist-web/, extension → dist/
```

Then in `chrome://extensions` → **Load unpacked** → select:

`…/focus-tracking-app/focus-tracking-app/dist`

Credentials are read in the generated `service-worker.js` via:

```js
importScripts("secrets.local.js"); // sets self.SUPABASE_URL / self.SUPABASE_PUBLISHABLE_KEY
FocusBuddyAuth.init({ url: globalThis.SUPABASE_URL, publishableKey: globalThis.SUPABASE_PUBLISHABLE_KEY })
```

1. Edit **`secrets.local.js`** at the **repo root** (gitignored). Packaging copies it into `dist/`.
2. Paste:
   - **Supabase API URL** → `self.SUPABASE_URL = "..."` (same as `VITE_SUPABASE_URL` in `.env.local`)
   - **Supabase publishable key** → `self.SUPABASE_PUBLISHABLE_KEY = "..."` (same as `VITE_SUPABASE_PUBLISHABLE_KEY` — never the secret/service-role key)
3. After changing `background.js` or `chrome-auth/`, run **`npm run build:extension`** again, then **Reload** the extension in Chrome.

Sign in from the popup. The session is stored in `chrome.storage.local` (not `localStorage`) so the **service worker** can read the authenticated user.

When a focus timer completes, the extension:

1. Saves a completed session locally (`chrome.storage`)
2. Recalculates XP / Focus Level / Focus Streak with the same helpers as the website
3. Syncs only `xp`, `focus_level`, `focus_streak` to Supabase
4. If sync fails, keeps local progress and queues a retry (flushed on next auth init / completion)

Task text, site visits, and distraction logs stay local and are not uploaded.
