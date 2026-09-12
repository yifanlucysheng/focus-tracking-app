# Focus Buddy

Chrome extension for focus tracking, with a dashboard, friends, and a lock-in companion.

## Install (anyone)

You do **not** need Vite or `npm run dev`.

1. Clone or download this repo from GitHub.
2. Open Chrome → `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `focus-tracking-app` folder (the one that contains `manifest.json`)

Pin Focus Buddy, click the icon, then **Open dashboard**. Create an account on Settings. Lock-in, folders, stats, and friends all run from that extension.

After you (or a teammate) change `background.js`, run `npm run build:extension` and click **Reload** on the extension card.

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

To sync session summary cards (longest session, sessions completed, top distraction / productive site, character health), run [`supabase/add_session_summary_stats.sql`](supabase/add_session_summary_stats.sql) once.
### 4. Run the website

```bash
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

After sign-up / sign-in / page reload, the client loads the current user's `profiles` row from Supabase (authoritative for public stats) and keeps it in memory via `getCachedProfile()`.

## Chrome extension auth

Accounts use **Firebase** (`web/firebase-config.js` / `secrets.public.js`), not a separate Vite server.

`npm run build:extension` writes a loadable package to `dist/` (and `focus-buddy-extension.zip`). Load unpacked from the **repo root** or from `dist/`.

Optional Gemini key: copy `secrets.local.example.js` → `secrets.local.js` and paste your key.

When a focus timer completes, the extension:

1. Saves a completed session locally (`chrome.storage`)
2. Recalculates XP / Focus Level / Focus Streak with the same helpers as the website
3. Syncs only `xp`, `focus_level`, `focus_streak` to Supabase
4. If sync fails, keeps local progress and queues a retry (flushed on next auth init / completion)

Task text, site visits, and distraction logs stay local and are not uploaded.
